#!/usr/bin/env node
// Re-create the demo's auth users on a rebuilt demo project, with their
// ORIGINAL uuids.
//
//   node supabase/ops/mint-demo-users.mjs --env=dev
//   node supabase/ops/mint-demo-users.mjs --env=dev --dry-run
//
// Runs behind the three fixture guards. Seeding users IS a fixture, so this
// belongs behind `fixtureGuard`, never `tenantGuard` — the two are deliberate
// mirror images and this script is firmly on the fixture side. It is the reason
// `bootstrap-admin.mjs` could not simply be widened: that one exists to make the
// FIRST admin on a paying client's project, one account at a time, leaving no
// password behind. This one mints eleven known logins with a shared password
// that is printed on the login page. They are opposites.
//
// ── WHY THE UUID IS THE WHOLE POINT ─────────────────────────────────────────
//
// `demo-export/` carries no password hashes (see export-demo.mjs), so every
// account must be re-minted. But it carries 92,000 rows that reference those
// accounts by id: `profiles.id`, `orders.created_by`, `visits.rep_id`,
// `pick_progress`, `audit_events.actor_id`, `horecas.created_by_user_id`, and
// more. Minting fresh uuids would orphan every one of them, and the failures
// would be silent — an order with a dangling `created_by` renders as an order
// placed by nobody.
//
// `auth.admin.createUser` accepts an explicit `id`, so the ids come from the
// export verbatim and every reference resolves. This is the only thing in the
// rebuild that CANNOT be repaired after the fact: once the data is imported
// against one set of ids, re-minting is a rewrite of every foreign key.
//
// ── AND WHY THE ROLE RIDES IN user_metadata ─────────────────────────────────
//
// `handle_new_user` (00001:1050) is an AFTER INSERT trigger on auth.users that
// writes the `profiles` row, reading
// `COALESCE(raw_user_meta_data->>'role', 'Restaurant/Hotel Customer')`. So the
// role must be present AT CREATION. Patching it afterwards would leave a window
// in which an Admin account carries a Customer's RLS — short, but real, and on a
// project we are about to import data into.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createClient } from '@supabase/supabase-js'

import { ROOT } from '../../scripts/lib/env.mjs'
import { requireDevTarget, orExitAsync } from '../../scripts/lib/fixtureGuard.mjs'

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')

const target = await orExitAsync(() =>
  requireDevTarget({
    argv,
    require: ['SUPABASE_SERVICE_ROLE_KEY', 'SEED_USER_PASSWORD'],
  }),
)

const EXPORT_DIR = join(ROOT, 'demo-export')
const usersPath = join(EXPORT_DIR, 'auth-users.json')

/** @type {Array<{id:string,email:string,raw_user_meta_data:any,email_confirmed_at:string|null}>} */
let users
try {
  users = JSON.parse(readFileSync(usersPath, 'utf8'))
} catch (e) {
  console.error(
    `\n[mint-users] cannot read ${usersPath}: ${e.message}\n` +
      `  This file is the output of export-demo.mjs and is gitignored. If it is\n` +
      `  missing, the archived copy is ../backup/demo-export-2026-08-12/.\n`,
  )
  process.exit(1)
}

const password = target.env.SEED_USER_PASSWORD

const supa = createClient(target.config.supabaseUrl, target.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

console.log(
  `[mint-users] ${target.name} (${target.config.projectRef}) ` +
    `— marker ${target.marker.name}/${target.marker.tenant_key}`,
)
console.log(`[mint-users] ${users.length} user(s) in ${usersPath}\n`)

// ---------------------------------------------------------------------------
// Validate the roster BEFORE creating anything
// ---------------------------------------------------------------------------

// A missing role would be created as a Customer by handle_new_user's COALESCE
// default and look like a successful run. Catch it here, where nothing has been
// written yet, rather than after five accounts exist.
const invalid = users.filter((u) => !u.id || !u.email || !u.raw_user_meta_data?.role)
if (invalid.length) {
  console.error(`\n[mint-users] ${invalid.length} row(s) lack an id, email or role:`)
  for (const u of invalid) console.error(`    ${u.id ?? '(no id)'} ${u.email ?? '(no email)'}`)
  console.error('  Refusing to mint a partial roster.\n')
  process.exit(1)
}

const dupeIds = users.map((u) => u.id).filter((id, i, a) => a.indexOf(id) !== i)
const dupeEmails = users.map((u) => u.email.toLowerCase()).filter((e, i, a) => a.indexOf(e) !== i)
if (dupeIds.length || dupeEmails.length) {
  console.error(`\n[mint-users] duplicate ${dupeIds.length ? 'id' : 'email'} in the export. Refusing.\n`)
  process.exit(1)
}

for (const u of users) {
  console.log(`  ${u.id}  ${u.email.padEnd(32)} ${u.raw_user_meta_data.role}`)
}

if (dryRun) {
  console.log(`\n[mint-users] --dry-run: would create ${users.length} user(s). Nothing written.\n`)
  await settle()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

console.log()
const created = []
const skipped = []
const failed = []

for (const u of users) {
  const role = u.raw_user_meta_data.role

  // Idempotent by id, so a partial run is resumed rather than restarted. Note
  // this checks the ID, not the email: an account created by hand with the same
  // address but a different uuid is NOT the account the imported data expects,
  // and silently accepting it would orphan every reference to the real one.
  const { data: existing } = await supa.auth.admin.getUserById(u.id)
  if (existing?.user) {
    const same = existing.user.email?.toLowerCase() === u.email.toLowerCase()
    skipped.push(u)
    console.log(
      `  skip     ${u.email.padEnd(32)} already exists` +
        (same ? '' : ` — but as ${existing.user.email}, NOT ${u.email}`),
    )
    if (!same) failed.push({ user: u, error: 'uuid exists under a different email' })
    continue
  }

  const { data, error } = await supa.auth.admin.createUser({
    id: u.id,
    email: u.email,
    password,
    // Mirrors the export: every demo account was confirmed, and an unconfirmed
    // one cannot sign in, which would make the login panel advertise a
    // credential that does not work.
    email_confirm: Boolean(u.email_confirmed_at),
    user_metadata: u.raw_user_meta_data,
  })

  if (error || !data?.user) {
    failed.push({ user: u, error: error?.message ?? 'no user returned' })
    console.log(`  FAIL     ${u.email.padEnd(32)} ${error?.message ?? 'no user returned'}`)
    continue
  }
  if (data.user.id !== u.id) {
    // Belt and braces: if a future auth-js ever ignored `id`, every subsequent
    // import would be built on the wrong references. Fail loudly, immediately.
    failed.push({ user: u, error: `id was not honoured — got ${data.user.id}` })
    console.log(`  FAIL     ${u.email.padEnd(32)} id not honoured (got ${data.user.id})`)
    continue
  }
  created.push(u)
  console.log(`  created  ${u.email.padEnd(32)} ${role}`)
}

// ---------------------------------------------------------------------------
// Verify: the trigger really did write a profile, with the right role
// ---------------------------------------------------------------------------

// Verified rather than assumed, for bootstrap-admin.mjs's reason: if the trigger
// were ever dropped, this would otherwise report success having created eleven
// logins with no profiles — every one of which fails requireAuth with a
// confusing FORBIDDEN, hours later, in the UI.
const { data: profiles, error: profilesError } = await supa
  .from('profiles')
  .select('id, email, role')
  .in('id', users.map((u) => u.id))

if (profilesError) {
  console.error(`\n[mint-users] could not read profiles back: ${profilesError.message}\n`)
  process.exit(1)
}

const byId = new Map(profiles.map((p) => [p.id, p]))
const noProfile = users.filter((u) => !byId.has(u.id))
const wrongRole = users
  .filter((u) => byId.has(u.id))
  .filter((u) => byId.get(u.id).role !== u.raw_user_meta_data.role)
  .map((u) => ({ email: u.email, want: u.raw_user_meta_data.role, got: byId.get(u.id).role }))

console.log(
  `\n[mint-users] ${created.length} created, ${skipped.length} already present, ` +
    `${failed.length} failed · ${profiles.length}/${users.length} profile rows present`,
)

if (noProfile.length) {
  console.error(`\n[mint-users] ✗ ${noProfile.length} auth user(s) have NO profile row:`)
  for (const u of noProfile) console.error(`    ${u.email}`)
  console.error(
    `  handle_new_user (00001:1050) should have written them. These logins exist\n` +
      `  and cannot be used. Investigate the trigger before importing any data.\n`,
  )
}
if (wrongRole.length) {
  console.error(`\n[mint-users] ✗ ${wrongRole.length} profile(s) have the wrong role:`)
  for (const w of wrongRole) console.error(`    ${w.email}: wanted ${w.want}, got ${w.got}`)
  console.error(`  handle_new_user reads raw_user_meta_data->>'role' at INSERT.\n`)
}
if (failed.length) {
  console.error(`\n[mint-users] ✗ ${failed.length} user(s) failed:`)
  for (const f of failed) console.error(`    ${f.user.email}: ${f.error}`)
}

if (failed.length || noProfile.length || wrongRole.length) {
  console.error(
    `\n[mint-users] Do NOT run import-demo.mjs until this is clean — the import\n` +
      `  references these ids and will fail on the first foreign key.\n`,
  )
  process.exitCode = 1
} else {
  console.log(
    `\n[mint-users] ✓ all ${users.length} accounts exist with their original uuids.\n` +
      `[mint-users]   Shared password is ${target.config.envFile}'s SEED_USER_PASSWORD. Next: import-demo.mjs\n`,
  )
}

await settle()

/** undici keep-alive vs process.exit on Windows — see fixtureGuard.orExitAsync. */
async function settle() {
  await new Promise((r) => setTimeout(r, 100))
}
