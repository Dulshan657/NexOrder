// Assert this project's Supabase Auth configuration via the Management API.
//
//   node supabase/apply-auth-config.mjs           # diff, then PATCH if it differs
//   node supabase/apply-auth-config.mjs --check   # diff only, exit 1 on drift
//
// Why this exists: the redirect allow-list is what makes the password-reset
// round trip land back on the app. It used to be a dashboard-only setting, so
// a stray edit or a project restore lost it silently. DESIRED below is the
// source of truth; running this makes the live project match it.
//
// Only the keys in DESIRED are sent. The GET response is never echoed back as
// a PATCH body — that would re-assert settings nobody reviewed.
//
// Reads SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (fallback to the known ref)
// from .env.local / the environment, exactly like apply-sql.mjs.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..') // NexOrder/

// The production origin. Also the Site URL, which Supabase substitutes whenever
// a requested redirectTo is not in the allow list — so this one is load-bearing
// twice over: invite-user passes no redirectTo at all and falls back to it.
const PROD_ORIGIN = 'https://nexorder.vercel.app'

// Allow-list entries are matched as globs; `*` does not cross a `/`, and `**`
// matches the rest of the path (including an empty one). ForgotPasswordDialog
// sends `${window.location.origin}/` — note the trailing slash — so every entry
// needs a path wildcard to match it.
const ALLOWED_ORIGINS = [
  `${PROD_ORIGIN}/**`,
  // Any local dev port. vite.config.ts pins 3000 today, but a port change
  // should not silently break the flow for whoever hits it next.
  'http://localhost:*/**',
  // Vercel preview deploys (project copy-of-curatif-order-system-v1.3 in the
  // dulshan657s-projects team). Without this, a reset requested from a preview
  // gets redirected to production instead.
  'https://*-dulshan657s-projects.vercel.app/**',
]

const DESIRED = {
  site_url: PROD_ORIGIN,
  uri_allow_list: ALLOWED_ORIGINS.join(','),
  // Matches the client-side check in ResetPasswordView (`password.length < 8`).
  // Left at the Supabase default of 6, the server would happily accept a
  // password the UI refuses.
  password_min_length: 8,
}

function loadEnv() {
  const env = { ...process.env }
  try {
    const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (env[m[1]] === undefined || env[m[1]] === '') env[m[1]] = v
    }
  } catch {
    /* rely on process.env */
  }
  return env
}

const ENV = loadEnv()
const TOKEN = ENV.SUPABASE_ACCESS_TOKEN
const REF = ENV.SUPABASE_PROJECT_REF || 'lsgkznyiabqitqfpveey'

if (!TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (set in NexOrder/.env.local).')
  process.exit(1)
}

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
  console.log(`Supabase auth config for project ${REF}`)

  const before = await request('GET')
  const stale = drift(before)

  if (stale.length === 0) {
    console.log('Already correct — no changes needed.')
    return 0
  }

  console.log(`${stale.length} setting(s) differ:`)
  report(before, stale)

  if (CHECK_ONLY) {
    console.error('\nDrift detected (--check). Run `npm run auth:config` to apply.')
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
