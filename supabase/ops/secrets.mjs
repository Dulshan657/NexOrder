#!/usr/bin/env node
// Edge Function secrets for one target: what must be set, what is set, and
// setting what is missing.
//
//   node supabase/ops/secrets.mjs --env=amadiya --check     # report only, exit 1 if incomplete
//   node supabase/ops/secrets.mjs --env=amadiya             # set what is missing
//   node supabase/ops/secrets.mjs --env=amadiya --overwrite # ... and replace what is already there
//
// PRODUCTION-LAUNCH-PLAN.md §A3.6 and MULTI-TENANT-ARCHITECTURE.md §4 both ask
// for this, and Gate A asserts `--check` exits 0.
//
// ── THE THREE DERIVED SECRETS ARE THE POINT ─────────────────────────────────
//
// `ALLOWED_ORIGINS`, `APP_URL` and `PO_OAUTH_APP_BASE` are NOT read from an env
// file. They are computed from `config/environments.mjs`, because every one of
// them has already caused an outage by being wrong or absent, and in each case
// the failure was silent AND successful:
//
//   - `ALLOWED_ORIGINS` missing on dev (2026-07-29) broke CORS on only the
//     three most recently deployed functions — `_shared/cors.ts` reads it once
//     per isolate at module load, so warm isolates kept serving. It read as a
//     client-side bug for a day.
//   - `APP_URL` used to default to the demo origin, so `send-email` sent a
//     client's customers links to a different deployment while answering
//     `sent: true`, and `health` polled the demo's /version.json so production
//     reported `ok` while production was down.
//   - `PO_OAUTH_APP_BASE` defaulted the same way and would have handed a
//     client's completed OAuth flow to the demo app.
//
// A value that must match the deployment's own hostnames has no business being
// hand-typed into a file per target. It is derived, reviewed in version control,
// and re-applied on every run — the ONLY three this script overwrites without
// being asked, because drift between the registry and the project IS the bug.
//
// Everything else is real secret material and is never overwritten silently.
// `PO_ENCRYPTION_KEY` especially: mailbox refresh tokens are encrypted with it
// and it cannot be rotated without re-consenting every mailbox.

import { resolveTarget, orExit } from '../../scripts/lib/env.mjs'

// Names Supabase injects into every function. Setting one by hand shadows the
// platform value; `--check` reports them so a missing SUPABASE_ANON_KEY (the
// canary in launch-plan §A3.2 — `invite-user`, `place-order`,
// `update-order-status` and `_shared/auth.ts` all read it) is visible.
const PLATFORM_INJECTED = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SUPABASE_JWKS',
  'SUPABASE_PUBLISHABLE_KEYS',
  'SUPABASE_SECRET_KEYS',
]

/** Computed from the registry. Always re-applied. */
const DERIVED = {
  ALLOWED_ORIGINS: (c) => c.corsOrigins.join(','),
  APP_URL: (c) => c.appOrigin,
  PO_OAUTH_APP_BASE: (c) => c.appOrigin,
}

/** Must be present for the fleet to work. Values come from the target's env file. */
const REQUIRED_FROM_FILE = [
  ['PO_ENCRYPTION_KEY', 'PO-inbox mailbox token encryption. NEVER copy between projects.'],
  ['POLL_INBOX_CRON_TOKEN', 'Bearer for the po-poll-inbox cron. Unset = the cron is refused.'],
  ['HEALTH_CRON_TOKEN', 'Bearer for the health-check cron. Unset = the cron is refused.'],
  ['OPENAI_API_KEY', 'PO extraction and floor-plan extraction.'],
]

/** Wanted, but the system runs without them. */
const OPTIONAL_FROM_FILE = [
  ['RESEND_API_KEY', 'Outbound email. Unset = send-email is dormant.'],
  ['EMAIL_FROM', 'Unset falls back to onboarding@resend.dev, which Resend delivers ONLY to the account owner — while still answering sent:true.'],
  ['EMAIL_REPLY_TO', 'Reply-to on outbound mail.'],
  ['ALERT_EMAIL', 'Where health alerts go.'],
  ['EMBED_PRODUCTS_CRON_TOKEN', 'Only needed if embed-products is driven by cron; it is service-role invoked today.'],
  ['GMAIL_OAUTH_CLIENT_ID', 'PO Inbox — deferred for Amadiya.'],
  ['GMAIL_OAUTH_CLIENT_SECRET', 'PO Inbox — deferred for Amadiya.'],
  ['OUTLOOK_OAUTH_CLIENT_ID', 'PO Inbox — deferred for Amadiya.'],
  ['OUTLOOK_OAUTH_CLIENT_SECRET', 'PO Inbox — deferred for Amadiya.'],
]

/** Must NOT exist. */
const FORBIDDEN = [
  ['PO_ENCRYPTION_KEY_ALLOW_RESET', 'Setting this lets the encryption key be replaced, silently orphaning every connected mailbox.'],
]

const argv = process.argv.slice(2)
const checkOnly = argv.includes('--check')
const overwrite = argv.includes('--overwrite')

const target = orExit(() => resolveTarget({ argv, require: ['SUPABASE_ACCESS_TOKEN'] }))
const { config, env } = target
const api = `https://api.supabase.com/v1/projects/${config.projectRef}/secrets`
const auth = { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` }

const listResp = await fetch(api, { headers: auth })
if (!listResp.ok) {
  console.error(`[secrets] HTTP ${listResp.status} listing secrets: ${await listResp.text()}`)
  process.exit(1)
}
// Only the NAMES are used. The API will hand back values and there is no reason
// for them to pass through this process, let alone its stdout.
const present = new Set((await listResp.json()).map((s) => s.name))

console.log(`[secrets] ${target.name} (${config.projectRef})\n`)

const toSet = []
const missing = []

for (const [name, derive] of Object.entries(DERIVED)) {
  const want = derive(config)
  // Always queued: this is the drift these three exist to prevent.
  toSet.push([name, want])
  console.log(`  derived   ${name.padEnd(28)} ${want}`)
}

console.log()
for (const [name, why] of REQUIRED_FROM_FILE) {
  const have = present.has(name)
  const value = env[name]
  if (have && !overwrite) {
    console.log(`  ok        ${name.padEnd(28)} set on the project`)
  } else if (value) {
    toSet.push([name, value])
    console.log(`  ${have ? 'replace ' : 'will set'}  ${name.padEnd(28)} from ${config.envFile}`)
  } else {
    missing.push([name, why])
    console.log(`  MISSING   ${name.padEnd(28)} ${why}`)
  }
}

console.log()
for (const [name, why] of OPTIONAL_FROM_FILE) {
  const have = present.has(name)
  const value = env[name]
  if (have && !overwrite) {
    console.log(`  ok        ${name.padEnd(28)} set on the project`)
  } else if (value) {
    toSet.push([name, value])
    console.log(`  ${have ? 'replace ' : 'will set'}  ${name.padEnd(28)} from ${config.envFile}`)
  } else {
    console.log(`  absent    ${name.padEnd(28)} ${why}`)
  }
}

console.log()
const forbiddenPresent = FORBIDDEN.filter(([name]) => present.has(name))
for (const [name, why] of FORBIDDEN) {
  console.log(`  ${present.has(name) ? 'FORBIDDEN' : 'clean    '} ${name.padEnd(28)} ${why}`)
}

console.log()
const platformMissing = PLATFORM_INJECTED.filter((n) => !present.has(n))
console.log(
  `  platform  ${PLATFORM_INJECTED.length - platformMissing.length}/${PLATFORM_INJECTED.length} injected names present` +
    (platformMissing.length ? ` — ABSENT: ${platformMissing.join(', ')}` : ''),
)
if (platformMissing.includes('SUPABASE_ANON_KEY')) {
  console.log(
    '            ⚠ SUPABASE_ANON_KEY is absent. invite-user, place-order,\n' +
      '              update-order-status, both document-URL functions and\n' +
      '              _shared/auth.ts (every requireAuth caller) read it.',
  )
}

if (checkOnly) {
  const bad = missing.length > 0 || forbiddenPresent.length > 0 || platformMissing.includes('SUPABASE_ANON_KEY')
  console.log(`\n[secrets] --check: ${bad ? '✗ incomplete' : '✓ complete'}`)
  process.exitCode = bad ? 1 : 0
} else if (toSet.length) {
  const resp = await fetch(api, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(toSet.map(([name, value]) => ({ name, value }))),
  })
  if (!resp.ok) {
    console.error(`\n[secrets] HTTP ${resp.status} setting secrets: ${await resp.text()}`)
    process.exit(1)
  }
  console.log(`\n[secrets] ✓ set ${toSet.length} secret(s).`)
  // Not a nicety. `_shared/cors.ts:53` and every other module-scope read happen
  // ONCE per isolate at boot, so a warm isolate keeps serving the value it
  // started with. Skipping this is what makes a secret change roll out
  // gradually and look like a client bug.
  console.log(`[secrets]   Now redeploy: npm run fn:deploy:${target.name}`)
  if (missing.length) {
    console.log(`[secrets] ⚠ still missing ${missing.length}: ${missing.map(([n]) => n).join(', ')}`)
    process.exitCode = 1
  }
} else {
  console.log('\n[secrets] nothing to do.')
}

// undici keep-alive vs process.exit on Windows — see fixtureGuard.orExitAsync.
await new Promise((r) => setTimeout(r, 100))
