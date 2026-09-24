// Swap the operator identity shown in the app (Settings, order documents,
// emails) for a generic one while recording the PO Inbox sales-demo video —
// and put it back afterwards.
//
//   node scripts/demo-video/app-identity.mjs --env=dev --set        snapshot + swap to generic identity
//   node scripts/demo-video/app-identity.mjs --env=dev --restore    write the snapshot back
//
// `app_settings` (mig 00013, singleton row id=1) carries the operator's
// identity in five columns: company_name, company_address, company_phone,
// company_email, company_logo_url. There is no ABN/business-number column in
// this schema, so nothing is done about one — the "obviously fake ABN"
// suggestion in the brief doesn't apply here.
//
// `--set` snapshots the CURRENT row to demo-video-out/app-settings-snapshot.json
// (gitignored) and writes a generic "NexOrder Demo Foods" identity. It
// deliberately leaves company_logo_url untouched — it's null in dev (no real
// client's logo is at risk), and the brief says to keep the logo unless it
// belongs to a real client.
//
// `--restore` writes the snapshot back verbatim and deletes the snapshot file
// on success, so a stray snapshot can't later be mistaken for "still swapped".
//
// Guarded against double-`--set`: if a snapshot already exists, --set refuses
// rather than overwriting it with the already-generic values (which would
// permanently lose the real identity on a second run before restoring).
//
// Dev-only fixture script. scripts/lib/devClient.mjs resolves the target
// (--env=dev), asserts the credentials belong to it, and asks the database
// itself whether it is dev before writing anything.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDevClient } from '../lib/devClient.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..') // NexOrder/
const OUT_DIR = resolve(ROOT, 'demo-video-out')
const SNAPSHOT_PATH = resolve(OUT_DIR, 'app-settings-snapshot.json')

// Every identity column app_settings actually has (inspected via
// information_schema on the dev database 2026-09-24). company_logo_url is
// captured for a faithful round-trip but never written by --set.
const IDENTITY_COLUMNS = ['company_name', 'company_address', 'company_phone', 'company_email', 'company_logo_url']

const GENERIC_IDENTITY = {
  company_name: 'NexOrder Demo Foods',
  company_address: '48 Distribution Way, Alexandria NSW 2015',
  company_phone: '+61 2 8000 4321',
  company_email: 'hello@nexorderdemo.com.au',
  // company_logo_url intentionally omitted — left as-is, see header comment.
}

const { supa } = await createDevClient()

async function loadIdentityRow() {
  const { data, error } = await supa.from('app_settings').select(IDENTITY_COLUMNS.join(', ')).eq('id', 1).single()
  if (error || !data) throw new Error(`app_settings lookup failed: ${error?.message ?? 'no row'}`)
  return data
}

async function writeIdentity(values) {
  const { error } = await supa.from('app_settings').update(values).eq('id', 1)
  if (error) throw new Error(`app_settings update failed: ${error.message}`)
}

async function doSet() {
  if (existsSync(SNAPSHOT_PATH)) {
    console.error(`A snapshot already exists at ${SNAPSHOT_PATH}.`)
    console.error('Run --restore first (or delete the file if you are certain it is stale) before --set again —')
    console.error('otherwise a second --set would overwrite the snapshot with the already-generic identity.')
    process.exit(1)
  }

  const current = await loadIdentityRow()
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n')
  console.log(`Snapshotted current identity -> ${SNAPSHOT_PATH}`)
  console.log(JSON.stringify(current, null, 2))

  await writeIdentity(GENERIC_IDENTITY)
  console.log('\nApp identity set to the generic showcase identity:')
  console.log(JSON.stringify(GENERIC_IDENTITY, null, 2))
  console.log('\nRun `node scripts/demo-video/app-identity.mjs --env=dev --restore` after recording.')
}

async function doRestore() {
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(`No snapshot found at ${SNAPSHOT_PATH} — nothing to restore. Run --set first.`)
    process.exit(1)
  }
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
  const values = {}
  for (const col of IDENTITY_COLUMNS) values[col] = snapshot[col] ?? null

  await writeIdentity(values)
  console.log('Restored app identity from snapshot:')
  console.log(JSON.stringify(values, null, 2))

  const after = await loadIdentityRow()
  const roundTripOk = IDENTITY_COLUMNS.every(col => (after[col] ?? null) === (values[col] ?? null))
  console.log(roundTripOk ? '\nRound-trip verified: values match the snapshot.' : '\nWARNING: round-trip mismatch — compare the output above with the snapshot.')

  rmSync(SNAPSHOT_PATH)
  console.log(`Removed ${SNAPSHOT_PATH}.`)
}

async function main() {
  const isSet = process.argv.includes('--set')
  const isRestore = process.argv.includes('--restore')
  if (isSet === isRestore) {
    console.error('Usage: node scripts/demo-video/app-identity.mjs --env=dev --set|--restore')
    process.exit(1)
  }
  if (isSet) {
    await doSet()
  } else {
    await doRestore()
  }
}

main().catch(err => {
  console.error('app-identity failed:', err)
  process.exit(1)
})
