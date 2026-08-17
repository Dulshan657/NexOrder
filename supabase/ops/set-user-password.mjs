#!/usr/bin/env node
// Set an EXISTING account's password on a tenant project.
//
//   $env:NEW_PASSWORD='…'                                    (PowerShell)
//   node supabase/ops/set-user-password.mjs --env=amadiya \
//        --email=someone@example.com --confirm=<projectRef>
//
//   ... --list       report every account on the project, write nothing
//   ... --dry-run    report what it would do, write nothing
//
// ── WHY THIS EXISTS, GIVEN bootstrap-admin.mjs DELIBERATELY DOES NOT ────────
//
// `bootstrap-admin.mjs` goes out of its way never to know a password: it mints a
// throwaway, sends a reset email, and lets the operator set their own. That is
// the right shape for creating an account, and it is still the right shape for
// most password changes — a reset link leaves no plaintext anywhere.
//
// It is the wrong shape for exactly one case, which is the case this script
// serves: setting a KNOWN credential on an account whose mailbox round trip is
// unavailable or too slow to wait on — a handover, a locked-out operator, a
// support call. Refusing to have a tool for that does not stop it happening; it
// gets done by hand with the service-role key and no guards at all. So this
// carries the four guards `requireTenantTarget` provides, refuses to CREATE
// anything, and verifies the result by signing in rather than trusting a 200.
//
// Tenant-only, like bootstrap-admin. `fixtureGuard` and `tenantGuard` are
// deliberate mirror images (see either file's header) — do not widen this to
// dev by reaching for the other one.
//
// ── AND WHY IT USES fetch RATHER THAN @supabase/supabase-js ─────────────────
//
// The tenant workspace is a detached worktree that need not have run
// `npm install`. `tenantGuard` → `env.mjs` → `managementApi.mjs` is entirely
// dependency-free, so keeping this script to `fetch` means it runs in a fresh
// tenant checkout with nothing installed. An ops script that first requires a
// dependency tree is an ops script you cannot use in the situation it is for.

import { requireTenantTarget } from '../../scripts/lib/tenantGuard.mjs'
import { orExitAsync } from '../../scripts/lib/fixtureGuard.mjs'
import { planPasswordChange } from '../../scripts/lib/passwordChange.mjs'

const argv = process.argv.slice(2)

// Argument shape is decided before the guards run: there is no point making the
// operator type out a project ref to be told they misspelled `--email`.
const plan = planPasswordChange({ argv, env: process.env })
if (plan.ok === false) {
  console.error(`\n[set-user-password] ${plan.problem}\n\n  ${plan.fix}\n`)
  process.exit(1)
}

const target = await orExitAsync(() =>
  requireTenantTarget({
    argv,
    require: ['SUPABASE_SERVICE_ROLE_KEY'],
    action: plan.mode === 'list' ? 'list the accounts' : `set the password for ${plan.email}`,
  }),
)

const base = target.config.supabaseUrl
const serviceKey = target.env.SUPABASE_SERVICE_ROLE_KEY
const adminHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
}

console.log(
  `[set-user-password] ${target.name} (${target.config.projectRef}) ` +
    `— marker ${target.marker.name}/${target.marker.tenant_key}`,
)

// ---------------------------------------------------------------------------
// Who is on this project
// ---------------------------------------------------------------------------

const users = await orFail('list the accounts', listUsers)
const roles = await orFail('read profiles', readProfileRoles)

console.log(`[set-user-password] ${users.length} account(s):\n`)
for (const u of users) {
  const role = roles.get(u.id) ?? u.user_metadata?.role ?? '(no profile)'
  console.log(
    `  ${(u.email ?? '(no email)').padEnd(38)} ${String(role).padEnd(24)} ` +
      `last sign-in ${u.last_sign_in_at ? u.last_sign_in_at.slice(0, 10) : 'never'}`,
  )
}
console.log()

if (plan.mode === 'list') {
  await settle()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Resolve the one account, and refuse to invent it
// ---------------------------------------------------------------------------

const matches = users.filter((u) => (u.email ?? '').toLowerCase() === plan.email)

if (matches.length === 0) {
  console.error(
    `\n[set-user-password] no account with email ${plan.email} on this project.\n` +
      `  This script changes an EXISTING account's password; it does not create one.\n` +
      `  To create the first Admin: npm run bootstrap:admin:${target.name} -- --email=… --confirm=${target.config.projectRef}\n`,
  )
  process.exit(1)
}
if (matches.length > 1) {
  // GoTrue folds addresses, so this should be impossible — but two accounts
  // sharing an address is exactly the state in which acting on "the" one is a
  // coin flip, and a coin flip on a client's database is not acceptable.
  console.error(
    `\n[set-user-password] ${matches.length} accounts share ${plan.email}: ` +
      `${matches.map((m) => m.id).join(', ')}.\n  Refusing to guess which one you meant.\n`,
  )
  process.exit(1)
}

const user = matches[0]
const role = roles.get(user.id) ?? user.user_metadata?.role ?? '(no profile)'
console.log(`[set-user-password] target: ${user.email} — ${role} — ${user.id}`)

if (plan.dryRun) {
  console.log(`\n[set-user-password] --dry-run: would set the password. Nothing written.\n`)
  await settle()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Set it
// ---------------------------------------------------------------------------

await orFail('set the password', () =>
  json(`${base}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ password: plan.password }),
  }),
)

console.log(`[set-user-password] ✓ password updated for ${user.email}`)

// ---------------------------------------------------------------------------
// Verify by signing in — a 200 on the write is a different claim
// ---------------------------------------------------------------------------

// A successful PUT says the row was updated. It does not say the credential
// opens the app: a password policy, a banned user, an unconfirmed email or a
// disabled provider all leave the write looking fine. The only honest check is
// the one the operator is about to perform.
const anonKey = target.env.VITE_SUPABASE_ANON_KEY
if (!anonKey) {
  console.log(
    `[set-user-password] ⚠ no VITE_SUPABASE_ANON_KEY in ${target.config.envFile} — ` +
      `skipping the sign-in check. Verify by hand at ${target.config.appOrigin}`,
  )
} else {
  try {
    const session = await json(`${base}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: plan.password }),
    })
    if (session?.access_token) {
      console.log(`[set-user-password] ✓ sign-in verified for ${user.email}`)
      // Don't leave a live session behind for a credential handover.
      await fetch(`${base}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
      }).catch(() => {})
    } else {
      console.error(`\n[set-user-password] ✗ sign-in returned no token.\n`)
      process.exitCode = 1
    }
  } catch (e) {
    console.error(
      `\n[set-user-password] ✗ the password was SET but sign-in failed: ${e.message}\n` +
        `  The account may be banned, unconfirmed, or below the project's password policy.\n`,
    )
    process.exitCode = 1
  }
}

console.log(
  `\n[set-user-password] Clear the credential from this shell:\n` +
    `    Remove-Item Env:\\NEW_PASSWORD      (PowerShell)\n` +
    `    unset NEW_PASSWORD                 (bash)\n`,
)

await settle()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Page through the admin user list. Small projects, but do not assume one page. */
async function listUsers() {
  const perPage = 200
  const all = []
  for (let page = 1; page <= 20; page++) {
    const body = await json(
      `${base}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers: adminHeaders },
    )
    const batch = body?.users ?? []
    all.push(...batch)
    if (batch.length < perPage) return all
  }
  console.error('[set-user-password] ⚠ stopped after 20 pages; the list may be incomplete.')
  return all
}

/** id → role, from `profiles`. The authoritative role; user_metadata can drift. */
async function readProfileRoles() {
  const rows = await json(`${base}/rest/v1/profiles?select=id,role`, { headers: adminHeaders })
  return new Map((rows ?? []).map((r) => [r.id, r.role]))
}

async function json(url, init) {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) {
    // The body carries GoTrue's actual complaint; the status alone reads as a
    // mystery. Trim it — an error page can be long.
    throw new Error(`${res.status} ${res.statusText} — ${text.slice(0, 400)}`)
  }
  return text ? JSON.parse(text) : null
}

async function orFail(what, fn) {
  try {
    return await fn()
  } catch (e) {
    console.error(`\n[set-user-password] could not ${what}: ${e.message}\n`)
    await settle()
    process.exit(1)
  }
}

/** undici keep-alive vs process.exit on Windows — see fixtureGuard.orExitAsync. */
async function settle() {
  await new Promise((r) => setTimeout(r, 100))
}
