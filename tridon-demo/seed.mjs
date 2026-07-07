// Arm the Tridon "cookie-cutter" hardware demo — one command, idempotent.
//
//   npm run demo:tridon:seed              arm the demo
//   npm run demo:tridon:seed -- --clean   tear it down
//   TRIDON_DEMO_SENDER="me@corp.com" npm run demo:tridon:seed   custom sender
//
// This is self-contained (everything the demo needs lives in tridon-demo/). It:
//   1. Creates the Admin login  tridon@nexorder.demo / Password123!  — the
//      frontend persona (lib/demoAccounts.ts) leads the sidebar with PO Inbox and
//      wears the Tridon logo.
//   2. Creates/updates the customer "Sydney Tools Wollongong" and points its
//      contact_email at DEMO_SENDER (the address you'll email the POs FROM). This
//      both resolves the customer deterministically AND marks the sender trusted.
//   3. REPOINTS DEMO_SENDER to Sydney Tools: strips it from any other customer's
//      contact_email and removes any other customer's sender_email alias for it,
//      then registers a sender_email alias → Sydney Tools (confidence 1).
//   4. Upserts the Sydney Tools catalog products, receives real stock through the
//      inventory ledger, and writes one po_product_aliases row per SKU so every
//      auto-PO line resolves deterministically (no AI fuzzy match).
//   5. Guarantees the review PO's "new tool" SKU (specs.mjs → REVIEW_UNKNOWN_CODE)
//      has NO product and NO alias, so that PO always lands in needs_review.
//
// ⚠ SENDER COLLISION: the default DEMO_SENDER (dulshanb@nexgeninnovations.com.au)
// is also the V2food demo's trusted sender. A sender_email maps to exactly one
// customer, so arming this demo repoints that address to Sydney Tools and
// disables V2food auto-approve for it until you re-run `npm run seed:v2food-demo`.
// To avoid the collision entirely, set TRIDON_DEMO_SENDER to a dedicated address.
//
// Credentials come from NexOrder/.env.local (VITE_SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY) or the environment.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

import { REVIEW_UNKNOWN_CODE } from './specs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..') // NexOrder/

const DEMO_EMAIL = 'tridon@nexorder.demo'
const DEMO_NAME = 'Tridon Australia'
const DEMO_ROLE = 'Admin'

const CUSTOMER_NAME = 'Sydney Tools Wollongong'
const CUSTOMER_ADDRESS = '63 Flinders St, Wollongong NSW 2500'
const DEFAULT_SENDER = 'dulshanb@nexgeninnovations.com.au'

// The Sydney Tools catalog (same SKUs as tests/fixtures/po-samples/sydney-tools-
// seed.mjs). `code` = the printed part number = product sku = alias source_code.
const LINES = [
  { code: '8801300SB', name: 'KNIPEX Pliers Alligator Multigrip 300mm', price: 64.10, pack: null },
  { code: '0201200SB', name: 'KNIPEX Combination Pliers Hi Leverage 200mm', price: 42.71, pack: null },
  { code: '7402200SB', name: 'KNIPEX Diagonal Cutters High Leverage 200mm', price: 62.65, pack: null },
  { code: 'KBP200', name: 'KNIPEX End Cutting Nipper 200mm (Box of 18)', price: 669.34, pack: 18 },
  { code: '2612200SB', name: 'KNIPEX Needle Nose Pliers Stork Beak 200mm', price: 52.59, pack: null },
  { code: 'STK99', name: 'KNIPEX STK99 End Cutting Nipper Twin Value Pack', price: 79.00, pack: null },
  { code: '310250C', name: 'RENNSTEIG 250mm Flat Cold Chisel', price: 19.62, pack: null },
  { code: '309035', name: 'TOLEDO Tyre Lever 600mm', price: 33.71, pack: null },
  { code: '321100', name: 'TOLEDO Air Blow Gun High Flow Safety 100mm', price: 14.89, pack: null },
  { code: '150B6', name: 'TOLEDO Rule Stainless Steel 150mm', price: 6.89, pack: null },
]

const STOCK_PER_PRODUCT = 50 // demo PO qtys top out at 12 — plenty of headroom.

function loadEnv() {
  const env = { ...process.env }
  try {
    const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (env[m[1]] === undefined || env[m[1]] === '') env[m[1]] = v
    }
  } catch {
    /* rely on process.env */
  }
  return env
}

const ENV = loadEnv()
const SUPABASE_URL = ENV.VITE_SUPABASE_URL || ENV.SUPABASE_URL
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY
const PASSWORD = ENV.SEED_USER_PASSWORD || 'Password123!'
const DEMO_SENDER = (ENV.TRIDON_DEMO_SENDER || DEFAULT_SENDER).trim().toLowerCase()
const UNKNOWN_SKU = REVIEW_UNKNOWN_CODE.toUpperCase()

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set in NexOrder/.env.local).')
  process.exit(1)
}

const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getAdminProfileId() {
  const { data, error } = await supa.from('profiles').select('id').eq('role', 'Admin').limit(1).maybeSingle()
  if (error) throw new Error(`profiles lookup: ${error.message}`)
  if (data) return data.id
  const any = await supa.from('profiles').select('id').limit(1).maybeSingle()
  if (any.error) throw new Error(`profiles lookup: ${any.error.message}`)
  if (!any.data) throw new Error('no profiles found — seed the database first (npx tsx supabase/seed.ts)')
  return any.data.id
}

async function getSupplierId() {
  const { data, error } = await supa.from('suppliers').select('id').limit(1).maybeSingle()
  if (error) throw new Error(`suppliers lookup: ${error.message}`)
  if (!data) throw new Error('no suppliers found — seed the database first (npx tsx supabase/seed.ts)')
  return data.id
}

async function findCustomer() {
  const { data, error } = await supa.from('horecas').select('id, name').eq('name', CUSTOMER_NAME).maybeSingle()
  if (error) throw new Error(`horecas lookup: ${error.message}`)
  return data
}

async function findAuthUser() {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    const hit = data.users.find(u => u.email?.toLowerCase() === DEMO_EMAIL)
    if (hit) return hit
    if (data.users.length < 1000) break
  }
  return null
}

// ---------------------------------------------------------------------------
// Seed steps
// ---------------------------------------------------------------------------
async function seedLogin() {
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
  }
  const { error: profErr } = await supa.from('profiles').upsert(
    { id: user.id, name: DEMO_NAME, email: DEMO_EMAIL, role: DEMO_ROLE, horeca_id: null },
    { onConflict: 'id' },
  )
  if (profErr) throw new Error(`profiles upsert: ${profErr.message}`)
  console.log(`Tridon demo login ready: ${DEMO_EMAIL} / ${PASSWORD} (role ${DEMO_ROLE}).`)
}

async function seedCustomerAndTrust(adminId) {
  // Customer with the demo sender as its trusted contact_email.
  let customer = await findCustomer()
  if (!customer) {
    const ins = await supa
      .from('horecas')
      .insert({ name: CUSTOMER_NAME, address: CUSTOMER_ADDRESS, contact_email: DEMO_SENDER })
      .select('id, name')
      .single()
    if (ins.error) throw new Error(`horecas insert: ${ins.error.message}`)
    customer = ins.data
  } else {
    const upd = await supa.from('horecas').update({ contact_email: DEMO_SENDER }).eq('id', customer.id)
    if (upd.error) throw new Error(`horecas contact_email: ${upd.error.message}`)
  }
  const horecaId = customer.id

  // REPOINT: steal the demo sender from any OTHER customer (e.g. the V2food demo)
  // so resolution is unambiguous and the sender_email unique constraint is free.
  const stripEmail = await supa
    .from('horecas')
    .update({ contact_email: null })
    .eq('contact_email', DEMO_SENDER)
    .neq('id', horecaId)
  if (stripEmail.error) console.warn(`  repoint contact_email: ${stripEmail.error.message}`)
  const stripAlias = await supa
    .from('po_customer_aliases')
    .delete()
    .eq('source_type', 'sender_email')
    .eq('source_value', DEMO_SENDER)
    .neq('horeca_id', horecaId)
  if (stripAlias.error) console.warn(`  repoint sender alias: ${stripAlias.error.message}`)

  // Register the sender_email alias → Sydney Tools (strongest resolver match).
  const existing = await supa
    .from('po_customer_aliases')
    .select('id')
    .eq('horeca_id', horecaId)
    .eq('source_type', 'sender_email')
    .eq('source_value', DEMO_SENDER)
    .maybeSingle()
  if (!existing.data) {
    const insAlias = await supa.from('po_customer_aliases').insert({
      horeca_id: horecaId,
      source_type: 'sender_email',
      source_value: DEMO_SENDER,
      confidence_at_creation: 1,
      created_by: adminId,
    })
    if (insAlias.error) console.warn(`  sender_email alias: ${insAlias.error.message}`)
  }
  return horecaId
}

async function seedProducts(adminId, supplierId, horecaId) {
  // Upsert the catalog products (keyed on sku = part code).
  const productRows = LINES.map(l => ({
    sku: l.code.toUpperCase(),
    name: l.name,
    description: `Tridon demo product — ${l.name}`,
    price: l.price,
    category: 'Other',
    unit: 'each',
    carton_size: l.pack ?? 1,
    supplier_id: supplierId,
  }))
  const upProd = await supa.from('products').upsert(productRows, { onConflict: 'sku' }).select('id, sku')
  if (upProd.error) throw new Error(`products upsert: ${upProd.error.message}`)
  const productIdByCode = new Map(upProd.data.map(p => [p.sku, p.id]))

  // Receive stock through the ledger so cache + balances agree (mig 00041).
  const receiveLines = LINES.map(l => ({
    product_id: productIdByCode.get(l.code.toUpperCase()),
    quantity: STOCK_PER_PRODUCT,
  }))
  const recv = await supa.rpc('inv_receive_stock', {
    p_lines: receiveLines,
    p_actor: adminId,
    p_receipt: { reference: 'Tridon demo seed' },
  })
  if (recv.error) {
    throw new Error(
      `inv_receive_stock: ${recv.error.message} — ensure an active warehouse exists (multi-warehouse migrations applied).`,
    )
  }

  // One product alias per line so every catalogued line resolves deterministically.
  for (const l of LINES) {
    const code = l.code.toUpperCase()
    const dupe = await supa
      .from('po_product_aliases')
      .select('id')
      .eq('horeca_id', horecaId)
      .eq('source_code', code)
      .maybeSingle()
    if (dupe.data) continue
    const ins = await supa.from('po_product_aliases').insert({
      horeca_id: horecaId,
      source_code: code,
      product_id: productIdByCode.get(code),
      default_pack_size: l.pack,
      confidence_at_creation: 1,
      created_by: adminId,
    })
    if (ins.error) console.warn(`  alias ${code}: ${ins.error.message}`)
  }
}

/** Guarantee the review PO's "new tool" never resolves: no alias (any customer),
 *  no product. If a prior demo mapped it, undo that so review always flags. */
async function ensureUnknownIsUncatalogued() {
  const delAlias = await supa
    .from('po_product_aliases')
    .delete()
    .eq('source_code', UNKNOWN_SKU)
  if (delAlias.error) console.warn(`  unknown alias cleanup: ${delAlias.error.message}`)
  const delProd = await supa.from('products').delete().eq('sku', UNKNOWN_SKU)
  if (delProd.error) {
    console.warn(`  unknown product left in place (referenced by an order?): ${delProd.error.message}`)
  }
}

async function seed() {
  const adminId = await getAdminProfileId()
  const supplierId = await getSupplierId()

  await seedLogin()
  const horecaId = await seedCustomerAndTrust(adminId)
  await seedProducts(adminId, supplierId, horecaId)
  await ensureUnknownIsUncatalogued()

  console.log('')
  console.log(`Armed Tridon demo. Customer "${CUSTOMER_NAME}" (id ${horecaId}), ${LINES.length} SKUs + stock.`)
  console.log(`Trusted sender: ${DEMO_SENDER}`)
  console.log(`Review PO's uncatalogued tool: ${REVIEW_UNKNOWN_CODE} (no product/alias — will flag).`)
  console.log('')
  console.log('Next: email the two PDFs FROM the trusted sender into the demo inbox:')
  console.log('  tridon-demo/tridon-sydney-auto.pdf    → auto-approves')
  console.log('  tridon-demo/tridon-sydney-review.pdf  → needs review')
  console.log('(regenerate the PDFs with `npm run demo:tridon:pdfs` if needed)')
  if (DEMO_SENDER === DEFAULT_SENDER) {
    console.warn('')
    console.warn('⚠ This sender is also the V2food demo sender — it is now repointed to Sydney')
    console.warn('  Tools. Re-run `npm run seed:v2food-demo` before running a V2food demo.')
  }
}

async function clean() {
  const customer = await findCustomer()
  if (customer) {
    const codes = LINES.map(l => l.code.toUpperCase())
    const delAlias = await supa
      .from('po_product_aliases')
      .delete()
      .eq('horeca_id', customer.id)
      .in('source_code', codes)
    if (delAlias.error) console.warn(`  alias delete: ${delAlias.error.message}`)

    const clearEmail = await supa.from('horecas').update({ contact_email: null }).eq('id', customer.id)
    if (clearEmail.error) console.warn(`  contact_email clear: ${clearEmail.error.message}`)

    const delSender = await supa
      .from('po_customer_aliases')
      .delete()
      .eq('horeca_id', customer.id)
      .eq('source_type', 'sender_email')
    if (delSender.error) console.warn(`  sender_email alias delete: ${delSender.error.message}`)

    const delProd = await supa.from('products').delete().in('sku', codes)
    if (delProd.error) console.warn(`  products left in place (referenced by an order?): ${delProd.error.message}`)
    console.log(`Cleaned Tridon demo data for "${CUSTOMER_NAME}".`)
  } else {
    console.log(`HoReCa "${CUSTOMER_NAME}" not found — nothing to clean.`)
  }

  const user = await findAuthUser()
  if (user) {
    const { error } = await supa.auth.admin.deleteUser(user.id)
    if (error) console.warn(`  deleteUser: ${error.message}`)
    else console.log(`Deleted Tridon demo login "${DEMO_EMAIL}".`)
  }
  console.log('Note: `--clean` does not remove queued POs/orders — use `npm run demo:tridon:reset` for that.')
}

async function main() {
  if (process.argv.includes('--clean')) await clean()
  else await seed()
}

main().catch(err => {
  console.error('tridon-demo seed failed:', err)
  process.exit(1)
})
