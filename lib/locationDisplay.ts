// How a location is presented to an operator: name first, code underneath.
//
// The problem this exists for: `L4 · NEXG-B-9-4-L4` is a grid coordinate wearing
// a hyphen, and nobody standing in a warehouse can read it. Since mig 00094 a
// location also carries a composed NAME — "Chiller · Rack 7 · L4" — drawn from
// the area the operator painted over the racks.
//
// THE CODE IS STILL THE IDENTITY. It is the barcode payload, what `resolveScan`
// matches, a `materialized_path` segment and the CSV `bin_code` column. So it
// never disappears: it moves to a second line in small mono type, where it is
// still there to cross-check against a sticker and still there to search. This
// module only decides which string goes where.
//
// Client-only, deliberately. The server composes names (via the pure
// _shared/wie/locationNaming.ts, which both runtimes share) but has no opinion
// about typography. `describeScanMatch` in lib/scan/resolveScan.ts already
// renders `code · name` and is left alone.

import { isUninformativeName } from '@/lib/locationNaming'

export { isUninformativeName }

/** The minimum a caller needs to render a location. */
export interface DisplayLocation {
  code: string
  name?: string | null
}

/**
 * The headline: the name when it says something, the code otherwise.
 *
 * The fallback is not defensive padding — it is the normal case on every
 * warehouse that predates mig 00094, where `locations.name` holds `Bin 9,4` or
 * `Level 4`. Those are strictly worse than the code (they repeat the coordinate
 * and drop the warehouse), so `isUninformativeName` sends them to the back.
 */
export function locationTitle(loc: DisplayLocation | null | undefined): string {
  if (!loc) return '—'
  const name = (loc.name ?? '').trim()
  return isUninformativeName(name, loc.code) ? loc.code : name
}

/**
 * The scannable identity, or '' when it is already the headline.
 *
 * Returning '' rather than the code is what stops an un-named bin rendering the
 * same string twice, once bold and once grey.
 */
export function locationSubtitle(loc: DisplayLocation | null | undefined): string {
  if (!loc) return ''
  return locationTitle(loc) === loc.code ? '' : loc.code
}

/**
 * One-line receipt form: "Chiller · Rack 7 · L4 (NEXG-B-9-4-L4)".
 *
 * For toasts and confirm text — a receipt of something that already happened,
 * where both the readable name and the auditable code belong. NOT for a scan
 * prompt: see the note on ScanField usage in the design doc — an "expecting X"
 * prompt must quote the code alone, because the code is what is printed large on
 * the sticker the operator is holding.
 */
export function locationOneLine(loc: DisplayLocation | null | undefined): string {
  if (!loc) return '—'
  const title = locationTitle(loc)
  return title === loc.code ? loc.code : `${title} (${loc.code})`
}

/**
 * The last segment of a composed name: "Chiller · Rack 7 · L4" → "L4".
 *
 * For the canvases, where horizontal room is measured in a few characters. The
 * area name is already drawn as its own wayfinding layer across the whole
 * region, so repeating it on every bin inside spends the entire label on the one
 * part the operator can already see.
 */
export function nameTail(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return ''
  const cut = trimmed.lastIndexOf('·')
  return cut < 0 ? trimmed : trimmed.slice(cut + 1).trim()
}

/**
 * The last two segments: "Chiller · Rack 7 · L4" → "Rack 7 · L4".
 *
 * The middle tier for a canvas with room for more than a bare level but not the
 * area prefix. Same coarse-then-fine idea as `coarseCode` vs `shortCode`.
 */
export function nameTailPair(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return ''
  const parts = trimmed.split('·').map((p) => p.trim()).filter(Boolean)
  return parts.slice(-2).join(' · ')
}
