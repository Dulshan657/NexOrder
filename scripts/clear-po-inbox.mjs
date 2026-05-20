/**
 * Clear PO Inbox data — destructive maintenance script.
 *
 * Wipes the inbound-PO pipeline's data while KEEPING the connected mailboxes
 * (email_accounts) so polling continues on new mail. Deletes:
 *   - public.pending_pos          (all statuses)
 *   - public.po_extraction_audit
 *   - public.inbound_messages
 *   - public.po_customer_aliases
 *   - public.po_product_aliases
 *   - po-archive Storage bucket   (all objects)
 *
 * KEEPS: email_accounts (incl. watermark), oauth_pending_states, and all orders
 * (deleting a pending_po never deletes the order it became).
 *
 * Usage (run from the project root):
 *   node scripts/clear-po-inbox.mjs            # DRY RUN — prints counts, deletes nothing
 *   node scripts/clear-po-inbox.mjs --apply    # actually deletes
 *
 * Reads SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY from
 * the environment, falling back to .env.local. Service role bypasses RLS, which
 * is required because these tables/bucket are locked to Edge Functions.
 *
 * Idempotent: safe to re-run. Delete-all + bucket-walk converge to empty, so a
 * partial failure mid-run is recovered by simply running it again.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const APPLY = process.argv.includes('--apply')
const BUCKET = 'po-archive'
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

// Tables to clear, in FK-safe order:
//   pending_pos → inbound_messages is ON DELETE RESTRICT, so pending_pos first.
//   po_extraction_audit → inbound_messages is ON DELETE SET NULL (no block) but
//   we clear it too, so do it before inbound_messages for cleanliness.
const TABLES_IN_DELETE_ORDER = [
  'pending_pos',
  'po_extraction_audit',
  'inbound_messages',
  'po_customer_aliases',
  'po_product_aliases',
]

function parseEnvFile(text) {
  const env = {}
  for (let line of text.split(/\r?\n/)) {
    line = line.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice(7).trim()
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

function loadCreds() {
  const envPath = join(ROOT, '.env.local')
  const fileEnv = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {}
  const get = name => process.env[name] ?? fileEnv[name]
  const url = get('SUPABASE_URL') || get('VITE_SUPABASE_URL')
  const serviceKey = get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    console.error(
      'Missing SUPABASE_URL (or VITE_SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY.\n' +
        `Looked in process.env and ${envPath}.`,
    )
    process.exit(1)
  }
  return { url, serviceKey }
}

async function countTable(supabase, table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`count ${table}: ${error.message}`)
  return count ?? 0
}

async function deleteAll(supabase, table) {
  const { error } = await supabase.from(table).delete().neq('id', NIL_UUID)
  if (error) throw new Error(`delete ${table}: ${error.message}`)
}

/** Recursively list every object path under a prefix (folders have id === null). */
async function listAllObjects(supabase, prefix = '') {
  const files = []
  const limit = 1000
  let offset = 0
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit, offset })
    if (error) throw new Error(`list "${prefix || '/'}": ${error.message}`)
    if (!data || data.length === 0) break
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) {
        files.push(...(await listAllObjects(supabase, full)))
      } else {
        files.push(full)
      }
    }
    if (data.length < limit) break
    offset += limit
  }
  return files
}

async function removeObjects(supabase, paths) {
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100)
    const { error } = await supabase.storage.from(BUCKET).remove(chunk)
    if (error) throw new Error(`remove batch @${i}: ${error.message}`)
  }
}

async function report(supabase, label) {
  console.log(`\n=== ${label} ===`)
  for (const table of TABLES_IN_DELETE_ORDER) {
    const n = await countTable(supabase, table)
    console.log(`  ${table.padEnd(22)} ${n}`)
  }
  const objects = await listAllObjects(supabase)
  console.log(`  ${(BUCKET + ' (storage)').padEnd(22)} ${objects.length}`)
  // Kept-for-reference counts (NOT deleted):
  const accounts = await countTable(supabase, 'email_accounts')
  console.log(`  ${'email_accounts (KEPT)'.padEnd(22)} ${accounts}`)
  return objects
}

async function main() {
  const { url, serviceKey } = loadCreds()
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log(`PO Inbox cleaner — target project: ${url}`)
  console.log(APPLY ? 'MODE: APPLY (will delete)' : 'MODE: DRY RUN (no changes; pass --apply to delete)')

  const objectsBefore = await report(supabase, 'BEFORE')

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to delete the above.')
    return
  }

  console.log('\nDeleting…')
  for (const table of TABLES_IN_DELETE_ORDER) {
    await deleteAll(supabase, table)
    console.log(`  cleared ${table}`)
  }
  if (objectsBefore.length > 0) {
    await removeObjects(supabase, objectsBefore)
    console.log(`  removed ${objectsBefore.length} object(s) from ${BUCKET}`)
  } else {
    console.log(`  ${BUCKET} already empty`)
  }

  await report(supabase, 'AFTER')
  console.log('\nDone.')
}

main().catch(err => {
  console.error('\nclear-po-inbox failed:', err.message)
  process.exit(1)
})
