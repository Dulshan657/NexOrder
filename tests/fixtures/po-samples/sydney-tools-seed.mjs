// Seed the "Sydney Tools" auto-approve hero for the automotive PO demo.
//
//   node tests/fixtures/po-samples/sydney-tools-seed.mjs            seed
//   node tests/fixtures/po-samples/sydney-tools-seed.mjs --clean    remove
//   SYDNEY_TOOLS_SENDER="me@gmail.com" node …/sydney-tools-seed.mjs  custom sender
//
// What it sets up so PO #3380598 (PO 3380598.PDF) genuinely AUTO-APPROVES:
//   1. A HoReCa "Sydney Tools Wollongong" (created if missing).
//   2. Its contact_email = the address the PO will be emailed FROM. This both
//      resolves the customer deterministically (resolveCustomer step 4:
//      horecas.contact_email = sender) AND marks that sender trusted
//      (buildTrustedSenders includes contact_email) — so no spoofing flag.
//   3. The 10 line products (KNIPEX/TOLEDO/RENNSTEIG) with real stock, received
//      through inv_receive_stock so the products.inventory cache + the
//      inventory_balances ledger agree (the cache alone is reset by the
//      reconcile cron, mig 00041 — stock MUST go through the ledger).
//   4. A po_product_aliases row per line (source_code = the PO's "Supp Item No")
//      so each line resolves to a product DETERMINISTICALLY (per-line
//      confidence 1.0, no AI fuzzy match).
//
// IMPORTANT — sender uniqueness: the trusted sender MUST differ from
// dulshan37gt@gmail.com (reserved for the Grand Hotel food backup). Send the
// Sydney Tools PO FROM the SYDNEY_TOOLS_SENDER address below to the demo inbox.
//
// Dev-only fixture script. scripts/lib/devClient.mjs resolves the target
// (--env=dev, baked into the npm script), asserts the credentials belong to
// it, and asks the database itself whether it is dev before writing anything.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDevClient } from '../../../scripts/lib/devClient.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..') // NexOrder/

const CUSTOMER_NAME = 'Sydney Tools Wollongong'
const CUSTOMER_ADDRESS = '63 Flinders St, Wollongong NSW 2500'
const DEFAULT_SENDER = 'orders@sydneytools.com.au'
// The header above has documented SYDNEY_TOOLS_SENDER since this script was
// written, and every use below reads SENDER -- but the line binding the two
// was never there, so the script died on `ReferenceError: SENDER is not
// defined` at the first customer insert. Found by the first ESLint run.
const SENDER = process.env.SYDNEY_TOOLS_SENDER || DEFAULT_SENDER

// The 10 lines from PO 3380598.PDF. `code` = the printed "Supp Item No"
// (becomes the po_product_aliases.source_code AND the product sku), `price` =
// the PO's ex-GST cost. KBP200 ships as a box of 18; the rest are EACH.
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

const STOCK_PER_PRODUCT = 50 // every PO line is qty 1; plenty of headroom.

const { supa, env: ENV, target: TARGET } = await createDevClient()

async function getAdminProfileId() {
  const { data, error } = await supa.from('profiles').select('id').limit(1).maybeSingle()
  if (error) throw new Error(`profiles lookup: ${error.message}`)
  if (!data) throw new Error('no profiles found — seed the database first (npx tsx supabase/seed.ts)')
  return data.id
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

async function clean() {
  const customer = await findCustomer()
  if (!customer) {
    console.log(`HoReCa "${CUSTOMER_NAME}" not found — nothing to clean.`)
    return
  }
  // Drop the product aliases this seed created (scoped to the customer).
  const codes = LINES.map(l => l.code.toUpperCase())
  const delAlias = await supa
    .from('po_product_aliases')
    .delete()
    .eq('horeca_id', customer.id)
    .in('source_code', codes)
  if (delAlias.error) console.warn(`  alias delete: ${delAlias.error.message}`)

  // Untrust the sender / break the deterministic match.
  const upd = await supa.from('horecas').update({ contact_email: null }).eq('id', customer.id)
  if (upd.error) console.warn(`  contact_email clear: ${upd.error.message}`)

  // Remove the sender_email alias for this customer (the po_text alias the
  // resolver auto-creates on AI matches is left alone — it's harmless).
  const delSender = await supa
    .from('po_customer_aliases')
    .delete()
    .eq('horeca_id', customer.id)
    .eq('source_type', 'sender_email')
  if (delSender.error) console.warn(`  sender_email alias delete: ${delSender.error.message}`)

  // Best-effort product delete (skipped silently if an order references them).
  const delProd = await supa.from('products').delete().in('sku', codes)
  if (delProd.error) {
    console.warn(`  products left in place (referenced by an order?): ${delProd.error.message}`)
  }
  console.log(`Cleaned Sydney Tools demo seed for "${CUSTOMER_NAME}".`)
}

async function seed() {
  const adminId = await getAdminProfileId()
  const supplierId = await getSupplierId()

  // 1 + 2. Customer with trusted contact_email.
  let customer = await findCustomer()
  if (!customer) {
    const ins = await supa
      .from('horecas')
      .insert({ name: CUSTOMER_NAME, address: CUSTOMER_ADDRESS, contact_email: SENDER })
      .select('id, name')
      .single()
    if (ins.error) throw new Error(`horecas insert: ${ins.error.message}`)
    customer = ins.data
  } else {
    const upd = await supa.from('horecas').update({ contact_email: SENDER }).eq('id', customer.id)
    if (upd.error) throw new Error(`horecas contact_email: ${upd.error.message}`)
  }
  const horecaId = customer.id

  // Also register a sender_email alias — the STRONGEST match (resolver step 1),
  // so the sender resolves to Sydney Tools even if a broader sender_domain alias
  // for another customer exists. (source_type, source_value) is unique, so a
  // value already claimed by another customer is surfaced, not silently ignored.
  const existingAlias = await supa
    .from('po_customer_aliases')
    .select('id, horeca_id')
    .eq('source_type', 'sender_email')
    .eq('source_value', SENDER)
    .maybeSingle()
  if (existingAlias.data && existingAlias.data.horeca_id !== horecaId) {
    console.warn(
      `⚠ sender_email "${SENDER}" already maps to horeca #${existingAlias.data.horeca_id}. ` +
        `Run that customer's --clean or pick a different SYDNEY_TOOLS_SENDER.`,
    )
  } else if (!existingAlias.data) {
    const insAlias = await supa.from('po_customer_aliases').insert({
      horeca_id: horecaId,
      source_type: 'sender_email',
      source_value: SENDER,
      confidence_at_creation: 1,
      created_by: adminId,
    })
    if (insAlias.error) console.warn(`  sender_email alias: ${insAlias.error.message}`)
  }

  // 3a. Upsert the 10 products (keyed on sku = the part code).
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

  // 3b. Receive stock through the ledger so the cache + balances agree.
  const receiveLines = LINES.map(l => ({
    product_id: productIdByCode.get(l.code.toUpperCase()),
    quantity: STOCK_PER_PRODUCT,
  }))
  const recv = await supa.rpc('inv_receive_stock', {
    p_lines: receiveLines,
    p_actor: adminId,
    p_receipt: { reference: 'Sydney Tools demo seed' },
  })
  if (recv.error) {
    throw new Error(
      `inv_receive_stock: ${recv.error.message} — ensure an active warehouse exists (multi-warehouse migrations applied).`,
    )
  }

  // 4. Per-line product alias so each line resolves deterministically.
  for (const l of LINES) {
    const code = l.code.toUpperCase()
    const productId = productIdByCode.get(code)
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
      product_id: productId,
      default_pack_size: l.pack,
      confidence_at_creation: 1,
      created_by: adminId,
    })
    if (ins.error) console.warn(`  alias ${code}: ${ins.error.message}`)
  }

  console.log(`Seeded "${CUSTOMER_NAME}" (id ${horecaId}) with 10 products + aliases + stock.`)
  console.log(`Trusted sender: ${SENDER}`)
  console.log(`→ Email PO 3380598.PDF FROM ${SENDER} to the demo inbox to watch it auto-approve.`)
  if (SENDER === 'dulshan37gt@gmail.com') {
    console.warn('⚠ This collides with the Grand Hotel food backup. Use a different SYDNEY_TOOLS_SENDER.')
  }
}

async function main() {
  if (process.argv.includes('--clean')) {
    await clean()
  } else {
    await seed()
  }
}

main().catch(err => {
  console.error('sydney-tools-seed failed:', err)
  process.exit(1)
})
