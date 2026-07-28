// Clean slate between Tridon demos — one command.
//
//   npm run demo:tridon:reset
//   npm run demo:tridon:reset -- --dry-run   show what would be deleted, delete nothing
//
// Because the demo uses REAL email (no injector auto-purge), each send leaves a
// row behind: inbound_messages → pending_pos → (for the auto PO) a real order.
// This wipes everything that came FROM the demo sender so the next demo starts
// from zero. It leaves the persona login, customer, products, and aliases intact
// — so you only reset between demos, you don't re-seed.
//
// Scope: inbound_messages whose from_address contains DEMO_SENDER. That catches
// both the auto and review POs regardless of how they resolved, and touches no
// other demo's or real customer's mail.
//
// FK ordering matters: delete pending_pos BEFORE orders. The orders→pending_pos
// link is ON DELETE SET NULL, so deleting an order while a still-auto_approved
// pending_pos references it would null approved_order_id and trip
// chk_pending_pos_approved_has_order. (Same ordering as inject.mjs purgeMessages.)
//
// Dev-only fixture script. scripts/lib/devClient.mjs resolves the target
// (--env=dev, baked into the npm script), asserts the credentials belong to
// it, and asks the database itself whether it is dev before writing anything.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDevClient } from '../scripts/lib/devClient.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..') // NexOrder/

const DEFAULT_SENDER = 'dulshanb@nexgeninnovations.com.au'
const DRY_RUN = process.argv.includes('--dry-run')

const { supa, env: ENV, target: TARGET } = await createDevClient()

/** Remove every object under a stored prefix like "po-archive/{acct}/{msg}". */
async function removeStoragePrefix(storedPrefix) {
  if (!storedPrefix) return
  const trimmed = storedPrefix.replace(/^\/+|\/+$/g, '')
  const slash = trimmed.indexOf('/')
  if (slash < 0) return
  const bucket = trimmed.slice(0, slash)
  const prefix = trimmed.slice(slash + 1)
  const { data: listing, error } = await supa.storage.from(bucket).list(prefix)
  if (error) {
    console.warn(`  storage list ${trimmed}: ${error.message}`)
    return
  }
  if (listing && listing.length > 0) {
    const paths = listing.map(o => `${prefix}/${o.name}`)
    const del = await supa.storage.from(bucket).remove(paths)
    if (del.error) console.warn(`  storage remove ${trimmed}: ${del.error.message}`)
  }
}

async function main() {
  // Find every inbound message from the demo sender (case-insensitive; tolerates
  // a "Display Name <addr>" from_address).
  const { data: inbound, error: inErr } = await supa
    .from('inbound_messages')
    .select('id, from_address, storage_path_prefix')
    .ilike('from_address', `%${DEMO_SENDER}%`)
  if (inErr) throw new Error(`inbound_messages lookup: ${inErr.message}`)

  if (!inbound || inbound.length === 0) {
    console.log(`No inbound messages from ${DEMO_SENDER} — already clean.`)
    return
  }
  const inboundIds = inbound.map(r => r.id)

  const { data: pendings, error: pErr } = await supa
    .from('pending_pos')
    .select('id, approved_order_id')
    .in('inbound_message_id', inboundIds)
  if (pErr) throw new Error(`pending_pos lookup: ${pErr.message}`)
  const orderIds = (pendings ?? []).map(p => p.approved_order_id).filter(Boolean)

  console.log(`Scope: sender ${DEMO_SENDER}`)
  console.log(`  inbound_messages : ${inboundIds.length}`)
  console.log(`  pending_pos      : ${(pendings ?? []).length}`)
  console.log(`  auto-created orders: ${orderIds.length}`)

  if (DRY_RUN) {
    console.log('\n--dry-run: nothing deleted.')
    return
  }

  // 1. pending_pos FIRST (before orders — see header note on FK ordering).
  const delPending = await supa.from('pending_pos').delete().in('inbound_message_id', inboundIds)
  if (delPending.error) throw new Error(`pending_pos delete: ${delPending.error.message}`)

  // 2. auto-created orders + their items.
  if (orderIds.length > 0) {
    const delItems = await supa.from('order_items').delete().in('order_id', orderIds)
    if (delItems.error) console.warn(`  order_items delete: ${delItems.error.message}`)
    const delOrders = await supa.from('orders').delete().in('id', orderIds)
    if (delOrders.error) console.warn(`  orders delete: ${delOrders.error.message}`)
  }

  // 3. inbound_messages.
  const delInbound = await supa.from('inbound_messages').delete().in('id', inboundIds)
  if (delInbound.error) throw new Error(`inbound_messages delete: ${delInbound.error.message}`)

  // 4. archived attachments (best-effort).
  for (const row of inbound) await removeStoragePrefix(row.storage_path_prefix)

  console.log(`\nReset complete. Removed ${inboundIds.length} message(s), ${(pendings ?? []).length} pending PO(s), ${orderIds.length} order(s).`)
  console.log('The queue is clear — re-send the two PDFs to run the demo again.')
}

main().catch(err => {
  console.error('tridon-demo reset failed:', err)
  process.exit(1)
})
