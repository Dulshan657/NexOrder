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
 * The desired auth config for one environment.
 *
 * site_url is load-bearing twice over: Supabase substitutes it whenever a
 * requested redirectTo is NOT in the allow list, and `invite-user` passes no
 * redirectTo at all, so it falls back to this.
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

function report(live, keys) {
  for (const key of keys) {
    console.log(`  ${key}`)
    console.log(`    live:    ${JSON.stringify(live[key] ?? null)}`)
    console.log(`    desired: ${JSON.stringify(DESIRED[key])}`)
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
    console.log(`  ${key} = ${JSON.stringify(after[key])}`)
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
