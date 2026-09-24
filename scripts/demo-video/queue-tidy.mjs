// Clear the demo's stale PO Inbox "Needs Review" backlog off camera while
// recording the sales-demo video — and put it back afterwards.
//
//   node scripts/demo-video/queue-tidy.mjs --env=dev --hide      snapshot + move them out of Needs Review
//   node scripts/demo-video/queue-tidy.mjs --env=dev --restore   put them back in Needs Review
//
// The demo database carries ~20 old test POs in `needs_review` ("po 8",
// "no customer matched"…). Needs Review never archives on its own — the
// Archive view is resolved statuses older than a cutoff
// (services/supabase/poArchive.ts) — so `--hide` marks them `rejected`, with
// the demo Admin as reviewer (chk_pending_pos_rejected_has_reviewer requires
// one). A trigger stamps `updated_at`, so they sit in the Rejected tab until
// the archive cutoff passes; the video never opens that tab.
//
// Only rows created BEFORE today are touched, so the showcase's own
// needs-review PO (injected just before recording) is never hidden.
//
// `--hide` snapshots each row's original status/review columns to
// demo-video-out/needs-review-snapshot.json (gitignored) and refuses to run
// if a snapshot already exists; `--restore` writes it back verbatim and
// deletes the file. Dev-only: scripts/lib/devClient.mjs asserts the target.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDevClient } from '../lib/devClient.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, '../../demo-video-out')
const SNAPSHOT_PATH = resolve(OUT_DIR, 'needs-review-snapshot.json')
const COLUMNS = ['id', 'status', 'rejection_reason', 'reviewed_by', 'reviewed_at', 'updated_at', 'created_at']
const HIDE_REASON = '[demo-video] hidden from the queue while recording — restore with queue-tidy --restore'

const { supa } = await createDevClient()

async function hide() {
  if (existsSync(SNAPSHOT_PATH)) {
    throw new Error(`snapshot already exists at ${SNAPSHOT_PATH} — run --restore first`)
  }
  const startOfToday = new Date()
  startOfToday.setUTCHours(0, 0, 0, 0)
  const { data, error } = await supa
    .from('pending_pos')
    .select(COLUMNS.join(', '))
    .eq('status', 'needs_review')
    .lt('created_at', startOfToday.toISOString())
  if (error) throw new Error(`pending_pos lookup failed: ${error.message}`)

  const { data: admin, error: adminErr } = await supa
    .from('profiles')
    .select('id')
    .eq('role', 'Admin')
    .order('created_at')
    .limit(1)
    .single()
  if (adminErr || !admin) throw new Error(`admin lookup failed: ${adminErr?.message ?? 'none'}`)

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(data, null, 2))
  const reviewedAt = new Date().toISOString()

  for (const row of data) {
    const { error: upErr } = await supa
      .from('pending_pos')
      .update({ status: 'rejected', rejection_reason: HIDE_REASON, reviewed_by: admin.id, reviewed_at: reviewedAt })
      .eq('id', row.id)
    if (upErr) throw new Error(`hide ${row.id} failed: ${upErr.message}`)
  }
  console.log(`hid ${data.length} stale needs-review POs (snapshot: ${SNAPSHOT_PATH})`)
}

async function restore() {
  if (!existsSync(SNAPSHOT_PATH)) throw new Error(`no snapshot at ${SNAPSHOT_PATH} — nothing to restore`)
  const rows = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  for (const row of rows) {
    const { id, created_at: _createdAt, ...original } = row
    const { error } = await supa.from('pending_pos').update(original).eq('id', id)
    if (error) throw new Error(`restore ${id} failed: ${error.message}`)
  }
  rmSync(SNAPSHOT_PATH)
  console.log(`restored ${rows.length} POs to their original state`)
}

const args = process.argv.slice(2)
if (args.includes('--hide')) await hide()
else if (args.includes('--restore')) await restore()
else {
  console.error('usage: queue-tidy.mjs --env=dev --hide|--restore')
  process.exit(2)
}
