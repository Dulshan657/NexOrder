// One-off cleanup: re-extract inbound POs that picked an inline signature
// image instead of the real PDF/Word attachment (the bug fixed in this
// change). Dry-run by default; pass --apply to actually reprocess.
//
//   node scripts/reprocess-misselected-pos.mjs            # list affected
//   node scripts/reprocess-misselected-pos.mjs --apply    # fix them
//
// "Affected" = a needs_review pending_po whose chosen document is an image
// (extracted_po.source.format === 'image') while the message's storage prefix
// also contains a real PDF/DOCX. We never touch approved/auto_approved/
// rejected rows. For each affected row we delete the stale needs_review row
// (extract-po short-circuits if a pending_po already exists) and re-invoke
// extract-po, which now deprioritizes the signature and picks the real doc.
//
// Dev-only. This deletes pending_pos rows and re-invokes extract-po; both are
// destructive enough that it goes through the same three-guard path as the seed
// scripts rather than reading whatever .env.local happens to hold.
import { createDevClient } from './lib/devClient.mjs'

const { supa, env: ENV, target: TARGET } = await createDevClient()
const url = TARGET.config.supabaseUrl
const key = ENV.SUPABASE_SERVICE_ROLE_KEY

const BUCKET = 'po-archive'
const apply = process.argv.includes('--apply')

const { data: pos, error } = await supa
  .from('pending_pos')
  .select('id, inbound_message_id, status, extracted_po, inbound_messages:inbound_message_id(storage_path_prefix)')
  .eq('status', 'needs_review')
  .limit(1000)

if (error) {
  console.error('query failed:', error.message)
  process.exit(1)
}

const candidates = (pos ?? []).filter(p => p?.extracted_po?.source?.format === 'image')
console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'} — ${candidates.length} needs_review PO(s) currently extracted from an image\n`)

let affected = 0
let fixed = 0
for (const p of candidates) {
  const joined = Array.isArray(p.inbound_messages) ? p.inbound_messages[0] : p.inbound_messages
  const prefix = (joined?.storage_path_prefix ?? '').replace(/^po-archive\//, '')
  if (!prefix) continue

  const { data: listing, error: listErr } = await supa.storage.from(BUCKET).list(prefix)
  if (listErr) {
    console.warn(`  skip ${p.id}: storage list failed — ${listErr.message}`)
    continue
  }
  const files = (listing ?? []).filter(e => e.name && e.name !== 'original.json').map(e => e.name)
  const hasRealDoc = files.some(n => /\.(pdf|docx|doc)$/i.test(n))
  if (!hasRealDoc) continue // genuine image-only PO — leave it alone

  affected++
  console.log(`affected: pending_po ${p.id}  msg ${p.inbound_message_id}\n   files: ${JSON.stringify(files)}`)

  if (!apply) continue

  const { error: delErr } = await supa
    .from('pending_pos')
    .delete()
    .eq('id', p.id)
    .eq('status', 'needs_review')
  if (delErr) {
    console.warn(`   delete failed — ${delErr.message}; skipping re-extract`)
    continue
  }
  const resp = await fetch(`${url}/functions/v1/extract-po`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inboundMessageId: p.inbound_message_id }),
  })
  console.log(`   re-extract → HTTP ${resp.status}`)
  if (resp.ok) fixed++
}

console.log(`\nDone. affected=${affected}${apply ? ` reprocessed=${fixed}` : ' (dry-run; pass --apply to fix)'}\n`)
