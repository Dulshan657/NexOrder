// Assert a Supabase project's Auth configuration via the Management API.
//
//   node supabase/apply-auth-config.mjs --env=dev           # diff, then PATCH
//   node supabase/apply-auth-config.mjs --env=dev --check   # diff only, exit 1 on drift
//
// Why this exists: the redirect allow-list is what makes the password-reset
// round trip land back on the app. It used to be a dashboard-only setting, so
// a stray edit or a project restore lost it silently. buildDesired() below is
// the source of truth; running this makes the live project match it.
//
// Only the keys it returns are sent. The GET response is never echoed back as
// a PATCH body — that would re-assert settings nobody reviewed.

import { resolveTarget, orExit } from '../scripts/lib/env.mjs'

/**
 * The link an auth email points at.
 *
 * WHY NOT `{{ .ConfirmationURL }}` (the Supabase default): that URL is
 * `https://<project-ref>.supabase.co/auth/v1/verify?…`, so the one place a
 * CLIENT actually reads a URL out of this system shows them a random
 * twenty-character project ref on a domain they have never heard of. The ref is
 * immutable and cannot be renamed; the link can.
 *
 * `{{ .TokenHash }}` is the supported way to point the link at your own app
 * instead. `lib/auth/recoveryLink.ts` has parsed exactly this shape —
 * `?token_hash=…&type=recovery|invite` — since the auth-link work, and its own
 * comment notes the project was still on the default template. This closes that.
 *
 * `{{ .SiteURL }}` and not `{{ .RedirectTo }}`, deliberately:
 *  - `invite-user` passes NO redirectTo (that is why it needs no allow-list
 *    entry), so `.RedirectTo` is empty for the invite flow and the link would
 *    have to be built through a Go-template conditional to cover both.
 *  - The cost is that a forgot-password started on `localhost:3000` mails a
 *    link to the DEPLOYED dev app rather than back to localhost. The token is
 *    still valid, so the reset completes — it just completes over there.
 *
 * `&amp;` rather than a bare `&` so the value is well-formed HTML regardless of
 * which template engine renders it; a parser hands `&` back to the browser.
 */
function authLink(type) {
  return `{{ .SiteURL }}/?token_hash={{ .TokenHash }}&amp;type=${type}`
}

/**
 * Email bodies are assembled from parts and joined with '' so the value sent
 * over the wire contains NO newlines.
 *
 * That is not cosmetic. `drift()` below compares live-vs-desired with a plain
 * string !==, and the Management API is free to normalise whitespace in a
 * multi-line HTML body. If it did, every run would report drift on a template
 * nobody had touched, and `auth:config:check` — which CI and Gate A both read
 * as a boolean — would be permanently red. A single line cannot be reflowed.
 */
const html = (...parts) => parts.join('')

const BODY_STYLE = 'font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1e293b;line-height:1.6'
const BUTTON_STYLE =
  'display:inline-block;background:#2988de;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600'
const MUTED_STYLE = 'color:#64748b;font-size:13px'

function recoveryEmail() {
  return html(
    `<div style="${BODY_STYLE}">`,
    '<h2 style="margin:0 0 16px">Reset your password</h2>',
    '<p>Choose a new password for your Nex Order account.</p>',
    `<p style="margin:24px 0"><a href="${authLink('recovery')}" style="${BUTTON_STYLE}">Choose a new password</a></p>`,
    // The hour is mailer_otp_exp below, and is stated as prose in
    // ForgotPasswordDialog too. Three copies now; change one, change all three.
    `<p style="${MUTED_STYLE}">This link expires in 1 hour and can be used once.</p>`,
    `<p style="${MUTED_STYLE}">If you did not ask for this, ignore this email — your password will not change.</p>`,
    '</div>',
  )
}

function inviteEmail() {
  return html(
    `<div style="${BODY_STYLE}">`,
    '<h2 style="margin:0 0 16px">You have been invited to Nex Order</h2>',
    // Not "reset your password" — an invited user has never had one. The auth
    // row exists with no password, so this link is the ONLY way they can ever
    // sign in.
    '<p>An administrator has created an account for you. Set a password to sign in for the first time.</p>',
    `<p style="margin:24px 0"><a href="${authLink('invite')}" style="${BUTTON_STYLE}">Set your password</a></p>`,
    `<p style="${MUTED_STYLE}">This link expires in 1 hour and can be used once. If it lapses, use “Forgot password” on the sign-in page.</p>`,
    '</div>',
  )
}

/**
 * The desired auth config for one environment.
 *
 * site_url is load-bearing three times over: Supabase substitutes it whenever a
 * requested redirectTo is NOT in the allow list, `invite-user` passes no
 * redirectTo at all so it falls back to this, and the email templates above
 * build their links from it.
 *
 * Allow-list entries are matched as GLOBS; `*` does not cross a `/`, and `**`
 * matches the rest of the path (including an empty one). ForgotPasswordDialog
 * sends `${window.location.origin}/` — note the trailing slash — so every entry
 * needs a path wildcard or it will not match.
 *
 * The preview glob (`https://*-dulshan657s-projects.vercel.app/**`) appears in
 * the DEV entry only. It must never reach production: it would make any preview
 * deployment a valid password-reset landing page for a client account.
 */
function buildDesired(config) {
  return {
    mailer_subjects_recovery: 'Reset your Nex Order password',
    mailer_templates_recovery_content: recoveryEmail(),
    mailer_subjects_invite: 'You have been invited to Nex Order',
    mailer_templates_invite_content: inviteEmail(),

    site_url: config.appOrigin,
    uri_allow_list: config.authRedirectAllowList.join(','),

    // Matches the client-side check in ResetPasswordView (`password.length < 8`).
    // Left at the Supabase default of 6, the server would happily accept a
    // password the UI refuses.
    password_min_length: 8,

    // A fresh Supabase project ships with signup ENABLED, and handle_new_user()
    // (00001:1050, SECURITY DEFINER) turns any successful signup into a working
    // Customer profile. On production that is an open door into the client's
    // system; every account here arrives by invitation.
    disable_signup: true,

    // No self-confirming accounts, and a recovery link that lasts an hour —
    // the 3600 is duplicated as prose in ForgotPasswordDialog ("expires in
    // 1 hour"). Change one, change the other.
    mailer_autoconfirm: false,
    mailer_otp_exp: 3600,
  }
}

const target = orExit(() => resolveTarget({ require: ['SUPABASE_ACCESS_TOKEN'] }))

const TOKEN = target.env.SUPABASE_ACCESS_TOKEN
const REF = target.config.projectRef
const DESIRED = buildDesired(target.config)

const CHECK_ONLY = process.argv.slice(2).includes('--check')
const ENDPOINT = `https://api.supabase.com/v1/projects/${REF}/config/auth`

class RequestFailed extends Error {}

async function request(method, body) {
  const resp = await fetch(ENDPOINT, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await resp.text()
  if (!resp.ok) {
    throw new RequestFailed(`HTTP ${resp.status} on ${method} config/auth: ${text}`)
  }
  return JSON.parse(text)
}

// Returns the keys of DESIRED whose live value differs.
function drift(live) {
  return Object.keys(DESIRED).filter(key => String(live[key] ?? '') !== String(DESIRED[key]))
}

// The email bodies are ~800 characters of HTML on one line. Printed whole they
// bury the four settings a human is actually scanning for.
const MAX_PREVIEW = 110

function preview(value) {
  const s = JSON.stringify(value ?? null)
  return s.length > MAX_PREVIEW ? `${s.slice(0, MAX_PREVIEW)}… (${s.length} chars)` : s
}

function report(live, keys) {
  for (const key of keys) {
    console.log(`  ${key}`)
    console.log(`    live:    ${preview(live[key])}`)
    console.log(`    desired: ${preview(DESIRED[key])}`)
  }
}

// Returns the process exit code. Nothing here calls process.exit() — doing so
// while the fetch keep-alive sockets are still open trips a libuv assertion on
// Windows, which looks like a crash on an otherwise successful run.
async function main() {
  console.log(`Supabase auth config for ${target.name} — project ${REF} (${target.config.label})`)

  const before = await request('GET')
  const stale = drift(before)

  if (stale.length === 0) {
    console.log('Already correct — no changes needed.')
    return 0
  }

  console.log(`${stale.length} setting(s) differ:`)
  report(before, stale)

  if (CHECK_ONLY) {
    console.error(`\nDrift detected (--check). Run \`npm run auth:config:${target.name}\` to apply.`)
    return 1
  }

  console.log('\nApplying…')
  await request('PATCH', DESIRED)

  // Re-read rather than trusting the PATCH response: the API normalises some
  // values (and silently ignores keys it does not recognise).
  const after = await request('GET')
  const remaining = drift(after)

  if (remaining.length > 0) {
    console.error('Applied, but these settings did not take:')
    report(after, remaining)
    return 1
  }

  for (const key of Object.keys(DESIRED)) {
    console.log(`  ${key} = ${preview(after[key])}`)
  }
  console.log('Done.')
  return 0
}

try {
  process.exitCode = await main()
} catch (err) {
  console.error(err instanceof RequestFailed ? err.message : err)
  process.exitCode = 1
}
