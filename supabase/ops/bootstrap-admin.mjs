#!/usr/bin/env node
// Create the FIRST Admin on a tenant project, and leave no password behind.
//
//   node supabase/ops/bootstrap-admin.mjs --env=amadiya \
//        --email=info@amadiya.com.au --name="Amadiya Agro Products" \
//        --confirm=<projectRef>
//
//   ... --dry-run    report what it would do, write nothing
//
// PRODUCTION-LAUNCH-PLAN.md §A3.9. This exists to break a chicken-and-egg:
// `invite-user` requires an existing Admin to authorise the invite, and a
// direct INSERT into `profiles` is RLS-blocked for every role the app has. So
// the first Admin on a new tenant cannot be made through the product at all.
//
// ── HOW IT AVOIDS WRITING A PASSWORD ANYWHERE ───────────────────────────────
//
// `auth.admin.createUser` requires a password. A throwaway one is generated
// with crypto.randomUUID(), used for nothing, never printed and never stored —
// the script immediately triggers a password-reset email, and the operator sets
// their own through the normal UI. So the credential that exists for the few
// seconds between those two calls is one nobody has ever seen.
//
// The role rides in `user_metadata`, which `handle_new_user` (00001:1050) reads
// to write the profile row: `COALESCE(raw_user_meta_data->>'role', 'Restaurant/
// Hotel Customer')`. That default is why the role must be passed at creation
// and not patched afterwards — a moment as a Customer is a moment with a
// customer's RLS.
//
// ── THE RESET EMAIL HAS TO ACTUALLY ARRIVE ──────────────────────────────────
//
// It is sent by Supabase Auth, not by the app's `send-email` function, so
// `RESEND_API_KEY` is irrelevant to it. What matters is that the project's
// redirect allow-list contains the target's origin (`npm run auth:config:<t>`)
// and that Auth → SMTP Settings is configured — the built-in mailer is
// rate-limited to a handful of messages an hour and stamps a supabase.io sender
// on the message. If the email does not arrive, that is where to look, and the
// script says so rather than reporting success.

import { createClient } from '@supabase/supabase-js'

import { requireTenantTarget } from '../../scripts/lib/tenantGuard.mjs'
import { orExitAsync } from '../../scripts/lib/fixtureGuard.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const dryRun = argv.includes('--dry-run')

const email = flag('email')
const name = flag('name') ?? email?.split('@')[0]
const role = flag('role') ?? 'Admin'

if (!email) {
  console.error('\n--email=<address> is required.\n')
  process.exit(1)
}
if (!['Admin', 'Manager'].includes(role)) {
  // Deliberately narrow. This script exists for the bootstrap case; every other
  // account should be created through `invite-user`, which audits the act.
  console.error(`\n--role must be Admin or Manager (got "${role}"). Use invite-user for anything else.\n`)
  process.exit(1)
}

const target = await orExitAsync(() =>
  requireTenantTarget({
    argv,
    require: ['SUPABASE_SERVICE_ROLE_KEY'],
    action: `create the first ${role} (${email})`,
  }),
)

const supa = createClient(target.config.supabaseUrl, target.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

console.log(
  `[bootstrap-admin] ${target.name} (${target.config.projectRef}) ` +
    `— marker ${target.marker.name}/${target.marker.tenant_key}`,
)

// Refuse to be the second bootstrap. If an Admin already exists, the product's
// own invite flow works and should be used, because it writes an audit event
// and this does not.
const { data: admins, error: adminsError } = await supa
  .from('profiles')
  .select('email, role')
  .in('role', ['Admin'])
if (adminsError) {
  console.error(`[bootstrap-admin] could not read profiles: ${adminsError.message}`)
  process.exit(1)
}
if (admins.length > 0 && !argv.includes('--anyway')) {
  console.error(
    `\n[bootstrap-admin] ${admins.length} Admin(s) already exist: ` +
      `${admins.map((a) => a.email).join(', ')}\n` +
      `  Use the product's Add User flow — it is authorised, audited, and works.\n` +
      `  Pass --anyway only if you know why that is not true here.\n`,
  )
  process.exit(1)
}

const { data: existing } = await supa.from('profiles').select('id, role').eq('email', email).maybeSingle()
if (existing) {
  console.error(`\n[bootstrap-admin] ${email} already has a profile (role ${existing.role}). Nothing to do.\n`)
  process.exit(1)
}

if (dryRun) {
  console.log(`\n[bootstrap-admin] --dry-run: would create ${email} as ${role} ("${name}") and send a reset.\n`)
  await settle()
  process.exit(0)
}

const { data: created, error: createError } = await supa.auth.admin.createUser({
  email,
  // Never printed, never stored, never used to sign in.
  password: `${crypto.randomUUID()}${crypto.randomUUID()}`,
  email_confirm: true,
  user_metadata: { name, role },
})
if (createError) {
  console.error(`\n[bootstrap-admin] createUser failed: ${createError.message}\n`)
  process.exit(1)
}

console.log(`[bootstrap-admin] ✓ auth user ${created.user.id}`)

// handle_new_user is an AFTER INSERT trigger, so the profile should already be
// there. Verify rather than assume: if the trigger were ever dropped, this
// script would otherwise report success having created a login with no profile,
// which fails every requireAuth in the fleet with a confusing FORBIDDEN.
const { data: profile, error: profileError } = await supa
  .from('profiles')
  .select('id, email, role')
  .eq('id', created.user.id)
  .maybeSingle()

if (profileError || !profile) {
  console.error(
    `\n[bootstrap-admin] ✗ auth user created but NO PROFILE ROW appeared.\n` +
      `  handle_new_user (00001:1050) should have written it. The login exists and\n` +
      `  cannot be used. Investigate the trigger before creating anyone else.\n`,
  )
  process.exit(1)
}
if (profile.role !== role) {
  console.error(
    `\n[bootstrap-admin] ✗ profile was created with role "${profile.role}", not "${role}".\n` +
      `  handle_new_user reads raw_user_meta_data->>'role' and defaults to Customer.\n`,
  )
  process.exit(1)
}
console.log(`[bootstrap-admin] ✓ profile ${profile.email} — ${profile.role}`)

const { error: resetError } = await supa.auth.resetPasswordForEmail(email, {
  redirectTo: `${target.config.appOrigin}/`,
})
if (resetError) {
  console.error(
    `\n[bootstrap-admin] ⚠ account created, but the reset email FAILED: ${resetError.message}\n` +
      `  The account has a password nobody knows. Drive Forgot-password from the\n` +
      `  login page, or re-send from the Supabase dashboard.\n`,
  )
  process.exitCode = 1
} else {
  console.log(`[bootstrap-admin] ✓ password-reset email sent to ${email}`)
  console.log(
    `\n  If it does not arrive, in this order:\n` +
      `    1. ${target.config.appOrigin}/** is in the redirect allow-list  (npm run auth:config:check:${target.name})\n` +
      `    2. Auth → SMTP Settings is configured  (the built-in mailer is rate-limited to a few per hour)\n` +
      `    3. the address is not in Supabase's bounce list\n`,
  )
}

await settle()

/** undici keep-alive vs process.exit on Windows — see fixtureGuard.orExitAsync. */
async function settle() {
  await new Promise((r) => setTimeout(r, 100))
}
