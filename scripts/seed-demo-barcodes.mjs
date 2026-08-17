// Give the demo catalogue supplier barcodes, so the GTIN path can be scanned.
//
//   npm run seed:barcodes:dev
//   npm run seed:barcodes:dev -- --reset      (set them all back to NULL)
//   npm run seed:barcodes:dev -- --limit=40   (default 40; 0 = every product)
//
// WHY THIS EXISTS: every one of the demo's 158 active products has
// `barcode = NULL`. That means `barcodeVariants` — the zero-padding that makes
// a UPC-A carton and its EAN-13 spelling the same item — has never been
// exercised by a real scanner, because there was nothing to scan. It is the
// most intricate branch in the resolver and the least proven.
//
// Dev-only, through `requireDevTarget`: the registry must mark the target as
// fixture-allowed, the loaded credentials must match that registry entry, and
// the database itself must say `environment_marker.name = 'dev'`. Three
// independent checks, because any one of them can be defeated by a single
// mistake. There is no --force.

import { requireDevTarget, orExitAsync } from './lib/fixtureGuard.mjs'
import { runSql } from './lib/managementApi.mjs'
import { barcodeFor } from './lib/demoBarcodes.mjs'

const DEFAULT_LIMIT = 40

function flag(name) {
  return process.argv.some((a) => a === `--${name}`)
}

function numericFlag(name, fallback) {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (!raw) return fallback
  const parsed = Number(raw.slice(name.length + 3))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/** Single-quote escaping for a literal we are about to splice into SQL. */
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

async function main() {
  // The Management API is the only route to the database from Windows — the
  // direct DB host is unreachable here, which is why this is SQL over HTTPS and
  // not supabase-js.
  const target = await requireDevTarget({ require: ['SUPABASE_ACCESS_TOKEN'] })
  const reset = flag('reset')
  const limit = numericFlag('limit', DEFAULT_LIMIT)

  if (reset) {
    // Only ever clears what this script could have written. A demo product that
    // was given a real barcode by hand is left alone.
    const cleared = await runSql(
      target,
      `UPDATE public.products SET barcode = NULL
        WHERE barcode ~ '^[0-9]+$'
        RETURNING id`,
    )
    process.stdout.write(`[seed:barcodes] cleared ${cleared.length} numeric barcode(s) on ${target.name}\n`)
    return
  }

  const rows = await runSql(
    target,
    `SELECT id, sku, name FROM public.products
      WHERE is_active AND (barcode IS NULL OR barcode = '')
      ORDER BY id
      ${limit > 0 ? `LIMIT ${limit}` : ''}`,
  )

  if (rows.length === 0) {
    process.stdout.write('[seed:barcodes] every active product already has a barcode — nothing to do\n')
    return
  }

  // One statement, not one per row: 40 round trips through the Management API
  // is slow enough to look broken, and a half-applied seed would leave the
  // printed test sheet disagreeing with the database.
  const values = rows.map((r) => `(${r.id}, ${lit(barcodeFor(r.id))})`).join(', ')
  await runSql(
    target,
    `UPDATE public.products AS p
        SET barcode = v.barcode
       FROM (VALUES ${values}) AS v(id, barcode)
      WHERE p.id = v.id`,
  )

  process.stdout.write(`[seed:barcodes] stamped ${rows.length} product(s) on ${target.name}\n`)
  for (const r of rows.slice(0, 10)) {
    process.stdout.write(`  ${barcodeFor(r.id).padEnd(14)} ${r.sku.padEnd(16)} ${r.name}\n`)
  }
  if (rows.length > 10) process.stdout.write(`  … and ${rows.length - 10} more\n`)
  process.stdout.write('\nNext: node scripts/build-scan-test-sheet.mjs --env=dev\n')
}

await orExitAsync(main)
