// Register the demo's trusted sender so the two auto-approve POs (sent from
// dulshan37gt@gmail.com) resolve to + are trusted for The Grand Hotel.
//
//   node tests/fixtures/po-samples/demo-seed.mjs           seed the alias
//   node tests/fixtures/po-samples/demo-seed.mjs --clean   remove it
//
// This inserts a po_customer_aliases sender_email row. created_by is set to a
// real admin profile (operator-curated) so the edge-case injector's --clean
// (which only deletes created_by IS NULL aliases) won't remove it.
//
// Why one alias is enough: the resolver tries sender_email aliases FIRST, so any
// email from this address resolves to Grand Hotel; and detectSenderMismatch
// treats a sender_email alias as trusted, so there's no spoofing flag. Combined
// with exact in-stock SKUs + a clean document (≥0.95 confidence), the PO
// auto-approves.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDevClient } from '../../../scripts/lib/devClient.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..') // NexOrder/

const TRUSTED_SENDER = 'dulshan37gt@gmail.com'
const AUTO_CUSTOMER = 'The Grand Hotel'

const { supa, env: ENV, target: TARGET } = await createDevClient()

async function main() {
  const isClean = process.argv.includes('--clean')

  const grand = await supa.from('horecas').select('id').eq('name', AUTO_CUSTOMER).maybeSingle()
  if (grand.error) throw new Error(`horecas lookup: ${grand.error.message}`)
  if (!grand.data) {
    console.error(`HoReCa "${AUTO_CUSTOMER}" not found — seed the DB first.`)
    process.exit(1)
  }
  const horecaId = grand.data.id

  if (isClean) {
    const { error } = await supa
      .from('po_customer_aliases')
      .delete()
      .eq('horeca_id', horecaId)
      .eq('source_type', 'sender_email')
      .eq('source_value', TRUSTED_SENDER)
    if (error) throw new Error(`alias delete: ${error.message}`)
    console.log(`Removed demo trust: ${TRUSTED_SENDER} → ${AUTO_CUSTOMER}.`)
    return
  }

  const dupe = await supa
    .from('po_customer_aliases')
    .select('id')
    .eq('horeca_id', horecaId)
    .eq('source_type', 'sender_email')
    .eq('source_value', TRUSTED_SENDER)
    .maybeSingle()
  if (dupe.data) {
    console.log(`Demo trust already set: ${TRUSTED_SENDER} → ${AUTO_CUSTOMER}.`)
    return
  }

  const admin = await supa.from('profiles').select('id').limit(1).maybeSingle()
  if (admin.error || !admin.data) throw new Error('no profiles found — seed the DB first.')

  const { error } = await supa.from('po_customer_aliases').insert({
    horeca_id: horecaId,
    source_type: 'sender_email',
    source_value: TRUSTED_SENDER,
    confidence_at_creation: 1,
    created_by: admin.data.id,
  })
  if (error) throw new Error(`alias insert: ${error.message}`)
  console.log(`Demo trust set: ${TRUSTED_SENDER} → ${AUTO_CUSTOMER}. Auto-approve POs from this sender will sail through.`)
}

main().catch(err => {
  console.error('demo-seed failed:', err)
  process.exit(1)
})
