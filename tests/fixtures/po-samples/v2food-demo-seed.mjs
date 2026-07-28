// Create the V2food PO-Inbox demo login.
//
//   node tests/fixtures/po-samples/v2food-demo-seed.mjs            create
//   node tests/fixtures/po-samples/v2food-demo-seed.mjs --clean    delete
//
// One Supabase auth user (Admin role) whose email the frontend special-cases
// (lib/demoAccounts.ts → getDemoPersona) to lead the sidebar with
// PO Inbox → Order Import, keep the Shop visible, and wear V2food's logo.
// Admin role ⇒ no horeca_id. Idempotent: re-running is a no-op if the user exists.
//
// The customer/product/auto-approve data is seeded separately by
// young-jacksons-seed.mjs (run via `npm run seed:v2food-demo`).
//
// Dev-only fixture script. scripts/lib/devClient.mjs resolves the target
// (--env=dev, baked into the npm script), asserts the credentials belong to
// it, and asks the database itself whether it is dev before writing anything.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDevClient } from '../../../scripts/lib/devClient.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..') // NexOrder/

const DEMO_EMAIL = 'v2food@nexorder.demo'
const DEMO_NAME = 'v2food Australia'
const DEMO_ROLE = 'Admin'

const { supa, env: ENV, target: TARGET } = await createDevClient()

async function findAuthUser() {
  // listUsers is paginated; the demo DB is small so one page suffices, but page
  // through to be safe.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    const hit = data.users.find(u => u.email?.toLowerCase() === DEMO_EMAIL)
    if (hit) return hit
    if (data.users.length < 1000) break
  }
  return null
}

async function clean() {
  const existing = await findAuthUser()
  if (!existing) {
    console.log(`Auth user "${DEMO_EMAIL}" not found — nothing to clean.`)
    return
  }
  const { error } = await supa.auth.admin.deleteUser(existing.id)
  if (error) throw new Error(`deleteUser: ${error.message}`)
  // profiles row is removed by ON DELETE CASCADE from auth.users.
  console.log(`Deleted V2food demo account "${DEMO_EMAIL}".`)
}

async function seed() {
  let user = await findAuthUser()
  if (!user) {
    const { data, error } = await supa.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: DEMO_NAME, role: DEMO_ROLE },
    })
    if (error) throw new Error(`createUser: ${error.message}`)
    user = data.user
    console.log(`Created auth user "${DEMO_EMAIL}".`)
  } else {
    console.log(`Auth user "${DEMO_EMAIL}" already exists — ensuring profile.`)
  }

  // The on_auth_user_created trigger creates the profile from user_metadata, but
  // upsert to be safe (and to repair role/name on re-run). Admin ⇒ horeca_id null.
  const { error: profErr } = await supa.from('profiles').upsert(
    {
      id: user.id,
      name: DEMO_NAME,
      email: DEMO_EMAIL,
      role: DEMO_ROLE,
      horeca_id: null,
    },
    { onConflict: 'id' },
  )
  if (profErr) throw new Error(`profiles upsert: ${profErr.message}`)

  console.log(`V2food demo account ready: ${DEMO_EMAIL} / ${PASSWORD} (role ${DEMO_ROLE}).`)
  console.log('Open the app at /?brand=v2food for the branded login screen.')
}

async function main() {
  if (process.argv.includes('--clean')) {
    await clean()
  } else {
    await seed()
  }
}

main().catch(err => {
  console.error('v2food-demo-seed failed:', err)
  process.exit(1)
})
