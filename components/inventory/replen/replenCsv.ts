// The replenishment grid, as a spreadsheet and back.
//
// The grid exists so a site can be configured in one sitting; the CSV exists
// because half that work happens away from the site, in a spreadsheet, with the
// client's own numbers next to it. Export, argue about it in Excel, paste it
// back.
//
// MERGE, NEVER REPLACE. A blank cell leaves the stored value alone — the same
// rule the stocktake sheet applies to a counted quantity, and for the same
// reason: a partial file must never wipe the rows it says nothing about. `0` is
// a typed number and means zero.

import { downloadCsv } from '@/lib/csvExport'
import { parseCsv, toRecords } from '@/lib/csvImport'
import {
  baseToPacks,
  packsToBase,
  parseQtyEntry,
  type ReplenConfigRow,
  type ReplenDraft,
} from '@/lib/replenPolicy'

export const REPLEN_CSV_HEADERS = [
  'sku',
  'product',
  'bin_code',
  'min_packs',
  'max_packs',
  'pack_units',
  'min_base',
  'max_base',
  'replenishing',
] as const

function packsCell(base: number | null, row: ReplenConfigRow): string {
  if (base == null) return ''
  const packs = baseToPacks(base, row.packFactor)
  return Number.isInteger(packs) ? String(packs) : String(Number(packs.toFixed(3)))
}

/**
 * Export what is on screen, drafts included.
 *
 * Deliberately exports the DRAFT rather than the stored row: someone who has
 * filled twenty rows from the suggestion and wants to check them in a
 * spreadsheet before saving would otherwise get a file of blanks.
 */
export function exportReplenCsv(
  rows: readonly ReplenConfigRow[],
  drafts: Readonly<Record<number, ReplenDraft>>,
  binCodeOf: (binId: number | null) => string,
  filename: string,
): void {
  const body = rows.map((row) => {
    const draft = drafts[row.productId]
    const minText = draft ? draft.minText : packsCell(row.minQty, row)
    const maxText = draft ? draft.maxText : packsCell(row.maxQty, row)
    const minBase = parseQtyEntry(minText)
    const maxBase = parseQtyEntry(maxText)
    return [
      row.sku,
      row.name,
      binCodeOf(draft ? draft.binId : row.homeBinId),
      minText,
      maxText,
      String(row.packFactor ?? 1),
      typeof minBase === 'number' ? String(packsToBase(minBase, row.packFactor)) : '',
      typeof maxBase === 'number' ? String(packsToBase(maxBase, row.packFactor)) : '',
      row.replenEnabled ? 'yes' : 'no',
    ]
  })
  downloadCsv([...REPLEN_CSV_HEADERS], body, filename)
}

export interface CsvApplyResult {
  /** Drafts to merge into the grid, keyed by product id. */
  drafts: Record<number, ReplenDraft>
  matched: number
  /** Rows whose SKU is not in the grid, or whose bin code is unknown. */
  problems: string[]
}

/**
 * Read a file back onto the grid.
 *
 * Matches on `sku`. `bin_code` moves the slot when it names a bin that exists at
 * this site; an unknown code is reported and the row's existing bin is kept,
 * because silently dropping a bin change would leave the operator believing they
 * had moved a SKU's home.
 *
 * Only `min_packs` / `max_packs` are read. `min_base` / `max_base` are exported
 * for the operator's arithmetic and ignored on the way back in — two columns
 * that can disagree must have exactly one of them be authoritative.
 */
export function applyReplenCsv(
  text: string,
  rows: readonly ReplenConfigRow[],
  drafts: Readonly<Record<number, ReplenDraft>>,
  binIdByCode: ReadonlyMap<string, number>,
): CsvApplyResult {
  const parsed = parseCsv(text)
  const records = toRecords(parsed)
  const bySku = new Map(rows.map((r) => [r.sku.trim().toLowerCase(), r]))

  const next: Record<number, ReplenDraft> = {}
  const problems: string[] = [...parsed.warnings]
  let matched = 0

  records.forEach((record, index) => {
    const line = index + 2 // header is line 1
    const sku = (record.sku ?? '').trim()
    if (sku === '') return

    const row = bySku.get(sku.toLowerCase())
    if (!row) {
      problems.push(`Line ${line}: no product with SKU "${sku}" in this grid.`)
      return
    }

    const current = next[row.productId] ?? drafts[row.productId] ?? {
      binId: row.homeBinId,
      minText: packsCell(row.minQty, row),
      maxText: packsCell(row.maxQty, row),
    }

    let binId = current.binId
    const binCode = (record.bin_code ?? '').trim()
    if (binCode !== '') {
      const resolved = binIdByCode.get(binCode.toLowerCase())
      if (resolved == null) {
        problems.push(`Line ${line}: no bin "${binCode}" at this warehouse — left as it was.`)
      } else {
        binId = resolved
      }
    }

    // Blank leaves the value alone; anything unusable is reported rather than
    // quietly treated as blank.
    const readCell = (raw: string | undefined, current: string, label: string): string => {
      const value = (raw ?? '').trim()
      if (value === '') return current
      if (parseQtyEntry(value) === undefined) {
        problems.push(`Line ${line}: "${value}" is not a usable ${label} — left as it was.`)
        return current
      }
      return value
    }

    next[row.productId] = {
      binId,
      minText: readCell(record.min_packs, current.minText, 'minimum'),
      maxText: readCell(record.max_packs, current.maxText, 'maximum'),
    }
    matched++
  })

  return { drafts: next, matched, problems }
}
