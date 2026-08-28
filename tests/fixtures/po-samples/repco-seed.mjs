// Seed the "Repco" auto-approve hero for the Tridon automotive PO demo.
//
//   node tests/fixtures/po-samples/repco-seed.mjs            seed
//   node tests/fixtures/po-samples/repco-seed.mjs --clean    remove
//   REPCO_SENDER="me@gmail.com" node …/repco-seed.mjs        custom sender
//
// Mirrors sydney-tools-seed.mjs. Sets up everything PO S486051891
// (11_900319_PO_S486051891_2026-05-21_140057636.pdf) needs to AUTO-APPROVE:
//   1. A HoReCa "Repco" (created if missing).
//   2. Its contact_email = the address the PO will be emailed FROM. This both
//      resolves the customer deterministically (resolveCustomer: horecas.contact_email
//      = sender) AND marks that sender trusted (no spoofing flag).
//   3. The single line product (Tridon Air Flow Meter, part TAF123) with real
//      stock, received through inv_receive_stock so the products.inventory cache
//      + inventory_balances ledger agree (the cache alone is reset by the
//      reconcile cron, mig 00041 — stock MUST go through the ledger).
//   4. A po_product_aliases row (source_code = the PO's "TAF123") so the line
//      resolves to the product DETERMINISTICALLY (confidence 1.0, no AI match).
//
// IMPORTANT — sender uniqueness: the trusted sender MUST differ from
// dulshan37gt@gmail.com (Grand Hotel food backup) and the Sydney Tools sender —
// one sender maps to one customer. Email the Repco PO FROM REPCO_SENDER to the
// demo inbox to watch it auto-approve.
//
// Dev-only fixture script. scripts/lib/devClient.mjs resolves the target
// (--env=dev, baked into the npm script), asserts the credentials belong to
// it, and asks the database itself whether it is dev before writing anything.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDevClient } from '../../../scripts/lib/devClient.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..') // NexOrder/

const CUSTOMER_NAME = 'Repco'
const CUSTOMER_ADDRESS = '24-26 Derwent Park Road, Derwent Park TAS 7009'
const DEFAULT_SENDER = 'orders@repco.com.au'
// The header above has documented REPCO_SENDER since this script was
// written, and every use below reads SENDER -- but the line binding the two
// was never there, so the script died on `ReferenceError: SENDER is not
// defined` at the first customer insert. Found by the first ESLint run.
const SENDER = process.env.REPCO_SENDER || DEFAULT_SENDER

// The single line from PO S486051891. `code` = the printed part number
// (becomes the po_product_aliases.source_code AND the product sku), `price` =
// the PO's ex-GST unit cost. Ships EACH.
const LINES = [
  { code: 'TAF123', name: 'Tridon Air Flow Meter (TAF123)', price: 132.85, pack: null },
]

const STOCK_PER_PRODUCT = 50 // PO line is qty 1; plenty of headroom.

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

  // Remove the sender_email alias for this customer.
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
  console.log(`Cleaned Repco demo seed for "${CUSTOMER_NAME}".`)
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

  // Register a sender_email alias — the STRONGEST match (resolver step 1), so the
  // sender resolves to Repco even if a broader sender_domain alias for another
  // customer exists. (source_type, source_value) is unique, so a value already
  // claimed by another customer is surfaced, not silently ignored.
  const existingAlias = await supa
    .from('po_customer_aliases')
    .select('id, horeca_id')
    .eq('source_type', 'sender_email')
    .eq('source_value', SENDER)
    .maybeSingle()
  if (existingAlias.data && existingAlias.data.horeca_id !== horecaId) {
    console.warn(
      `⚠ sender_email "${SENDER}" already maps to horeca #${existingAlias.data.horeca_id}. ` +
        `Run that customer's --clean or pick a different REPCO_SENDER.`,
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

  // 3a. Upsert the line product (keyed on sku = the part code).
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
    p_receipt: { reference: 'Repco demo seed' },
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

  console.log(`Seeded "${CUSTOMER_NAME}" (id ${horecaId}) with ${LINES.length} product(s) + alias + stock.`)
  console.log(`Trusted sender: ${SENDER}`)
  console.log(`→ Email PO S486051891 (11_900319…pdf) FROM ${SENDER} to the demo inbox to watch it auto-approve.`)
  if (SENDER === 'dulshan37gt@gmail.com') {
    console.warn('⚠ This collides with the Grand Hotel food backup. Use a different REPCO_SENDER.')
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
  console.error('repco-seed failed:', err)
  process.exit(1)
})
