// Seed the "Young & Jacksons" auto-approve setup for the V2food PO demo.
//
//   node tests/fixtures/po-samples/young-jacksons-seed.mjs            seed
//   node tests/fixtures/po-samples/young-jacksons-seed.mjs --clean    remove
//   YJ_SENDER="me@company.com" node …/young-jacksons-seed.mjs         custom sender
//
// Mirrors repco-seed.mjs, but the V2food products already live in the catalog
// (constants.ts → supabase/seed.ts), so this script does NOT create products —
// it looks them up by SKU and wires everything the Young & Jacksons POs need:
//   1. A HoReCa "Young & Jacksons" (created if missing).
//   2. Its contact_email = the trusted sender the POs are emailed FROM. This both
//      resolves the customer deterministically (horecas.contact_email = sender)
//      AND marks that sender trusted (no spoofing flag).
//   3. A po_customer_aliases sender_email row for the same address (strongest match).
//   4. For each V2food SKU: real stock received through inv_receive_stock (so the
//      products.inventory cache + inventory_balances ledger agree) + a
//      po_product_aliases row (source_code = SKU) so the line resolves
//      DETERMINISTICALLY (confidence 1.0, no AI fallback).
//
// The auto PO (YJ-2026-0617) lists only aliased SKUs → auto-approves. The review
// PO (YJ-2026-0618) adds "v2food Plant-Based Sausages 1kg" (no SKU, not in the
// catalog) so that line stays unresolved and the PO routes to needs_review.
//
// IMPORTANT — sender uniqueness: YJ_SENDER must differ from every other demo
// sender (Grand Hotel / Repco / Sydney Tools); one sender maps to one customer.
//
// Run `npx tsx supabase/seed.ts` first so the V2food products exist.
// Dev-only fixture script. scripts/lib/devClient.mjs resolves the target
// (--env=dev, baked into the npm script), asserts the credentials belong to
// it, and asks the database itself whether it is dev before writing anything.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDevClient } from '../../../scripts/lib/devClient.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..') // NexOrder/

const CUSTOMER_NAME = 'Young & Jacksons'
const CUSTOMER_ADDRESS = 'Corner Swanston & Flinders Streets, Melbourne VIC 3000'
const DEFAULT_SENDER = 'dulshanb@nexgeninnovations.com.au'

// V2food SKUs referenced by the demo POs (must already exist via supabase/seed.ts).
// Each becomes a po_product_aliases.source_code and receives demo stock.
const SKUS = ['V2F-MINCE-001', 'V2F-BURG-001', 'V2F-SCHN-001', 'V2F-PIES-001', 'V2F-TEND-001']

const STOCK_PER_PRODUCT = 60 // PO lines are qty 4–6; plenty of headroom.

const { supa, env: ENV, target: TARGET } = await createDevClient()

async function getAdminProfileId() {
  const { data, error } = await supa.from('profiles').select('id').limit(1).maybeSingle()
  if (error) throw new Error(`profiles lookup: ${error.message}`)
  if (!data) throw new Error('no profiles found — seed the database first (npx tsx supabase/seed.ts)')
  return data.id
}

async function findProductIdsBySku() {
  const { data, error } = await supa.from('products').select('id, sku').in('sku', SKUS)
  if (error) throw new Error(`products lookup: ${error.message}`)
  const bySku = new Map((data ?? []).map(p => [p.sku, p.id]))
  const missing = SKUS.filter(sku => !bySku.has(sku))
  if (missing.length > 0) {
    throw new Error(
      `V2food products not found: ${missing.join(', ')}. Run \`npx tsx supabase/seed.ts\` first.`,
    )
  }
  return bySku
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
  const delAlias = await supa
    .from('po_product_aliases')
    .delete()
    .eq('horeca_id', customer.id)
    .in('source_code', SKUS)
  if (delAlias.error) console.warn(`  alias delete: ${delAlias.error.message}`)

  const upd = await supa.from('horecas').update({ contact_email: null }).eq('id', customer.id)
  if (upd.error) console.warn(`  contact_email clear: ${upd.error.message}`)

  const delSender = await supa
    .from('po_customer_aliases')
    .delete()
    .eq('horeca_id', customer.id)
    .eq('source_type', 'sender_email')
  if (delSender.error) console.warn(`  sender_email alias delete: ${delSender.error.message}`)

  console.log(`Cleaned Young & Jacksons demo seed (customer "${CUSTOMER_NAME}" kept, products untouched).`)
}

async function seed() {
  const adminId = await getAdminProfileId()
  const productIdBySku = await findProductIdsBySku()

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

  // 3. sender_email alias — the strongest customer match (resolver step 1).
  const existingAlias = await supa
    .from('po_customer_aliases')
    .select('id, horeca_id')
    .eq('source_type', 'sender_email')
    .eq('source_value', SENDER)
    .maybeSingle()
  if (existingAlias.data && existingAlias.data.horeca_id !== horecaId) {
    console.warn(
      `⚠ sender_email "${SENDER}" already maps to horeca #${existingAlias.data.horeca_id}. ` +
        `Run that customer's --clean or pick a different YJ_SENDER.`,
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

  // 4a. Receive stock through the ledger so the cache + balances agree.
  const receiveLines = SKUS.map(sku => ({ product_id: productIdBySku.get(sku), quantity: STOCK_PER_PRODUCT }))
  const recv = await supa.rpc('inv_receive_stock', {
    p_lines: receiveLines,
    p_actor: adminId,
    p_receipt: { reference: 'Young & Jacksons demo seed' },
  })
  if (recv.error) {
    throw new Error(
      `inv_receive_stock: ${recv.error.message} — ensure an active warehouse exists (multi-warehouse migrations applied).`,
    )
  }

  // 4b. Per-SKU product alias so each line resolves deterministically.
  for (const sku of SKUS) {
    const productId = productIdBySku.get(sku)
    const dupe = await supa
      .from('po_product_aliases')
      .select('id')
      .eq('horeca_id', horecaId)
      .eq('source_code', sku)
      .maybeSingle()
    if (dupe.data) continue
    const ins = await supa.from('po_product_aliases').insert({
      horeca_id: horecaId,
      source_code: sku,
      product_id: productId,
      default_pack_size: null,
      confidence_at_creation: 1,
      created_by: adminId,
    })
    if (ins.error) console.warn(`  alias ${sku}: ${ins.error.message}`)
  }

  console.log(`Seeded "${CUSTOMER_NAME}" (id ${horecaId}) with ${SKUS.length} product alias(es) + stock.`)
  console.log(`Trusted sender: ${SENDER}`)
  console.log('→ Auto PO YJ-2026-0617 will auto-approve; review PO YJ-2026-0618 parks on its new "Sausages" line.')
  console.log('→ Email the PDFs in tests/fixtures/po-samples/demo-pos/ FROM that sender, or rehearse with:')
  console.log('     npm run po-inject -- --files tests/fixtures/po-samples/demo-pos')
}

async function main() {
  if (process.argv.includes('--clean')) {
    await clean()
  } else {
    await seed()
  }
}

main().catch(err => {
  console.error('young-jacksons-seed failed:', err)
  process.exit(1)
})
