// A stock shortage, said in the unit the approver is looking at.
//
// The server counts stock in BASE units: "42 of X available, 48 requested". The
// stepper on the line counts in whatever the kitchen ordered in: "4", meaning
// 4 cartons of 12. Put side by side the two read as a contradiction, so the
// review modal says the shortage in the line's own unit and keeps the base-unit
// figure in brackets (so the two readings can be checked against each other).
//
// Pure: no React, no Supabase. `supabase/functions/_shared/orderPricing.ts` still
// writes the server's own message -- it is shared with place-order and the PO
// Inbox, which have no line to speak in -- and this replaces it on screen only.
//
// ── UNITS PER LINE ──────────────────────────────────────────────────────────
// Derived the way the server derives it (`orderPricing.ts` resolveItems): a line
// with a known `uomId` takes that UOM's factor (the base UOM being 1), and only a
// line with no known UOM falls back to its own `packSize`. Then it is CHECKED
// against `requested`, which the server computed from the same lines: if
// sum(quantity x unitsPerLine) does not equal it, the pack factor is not known
// here (a UOM list that has not loaded, a line edited since the preview), and
// "Set to 42" could mean 42 cartons. That case speaks in units only and offers
// no one-tap fix.

import type { ProductUom } from '@/types'

/** The part of a product UOM this needs. */
export type ShortageUom = Pick<ProductUom, 'id' | 'code' | 'factorToBase' | 'isBase'>

/** One draft line of the short product. */
export interface ShortageLine {
  quantity: number
  packSize?: number | null
  uomId?: number | null
}

export interface ShortageInput {
  productName: string
  /** Base units the server found reservable. */
  available: number
  /** Base units the order needs, summed over every line of this product. */
  requested: number
  /** The draft lines for this product, as the server was asked to price them. */
  lines: ReadonlyArray<ShortageLine>
  /** The product's UOMs, when known. Optional: `packSize` alone still works. */
  uoms?: ReadonlyArray<ShortageUom>
}

export interface ShortageDescription {
  /** The sentence for the callout of problems. */
  headline: string
  /** The short note under the line itself. */
  lineNote: string
  /**
   * The largest quantity of this line that fits: 0 means the line cannot stay, and
   * null means no single number on one line fixes it, so no one-tap fix is offered.
   */
  maxQty: number | null
}

const DEFAULT_PACK_NAME = 'carton'

interface ResolvedLine {
  quantity: number
  unitsPerLine: number
  /** The UOM's own name, when the line has a non-base UOM with one. */
  packName: string | null
}

/** Round away float noise (0.1 + 0.2) and print whole numbers without a decimal point. */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function pluralise(word: string, n: number): string {
  if (n === 1) return word
  // A UOM code stored in capitals ("PCS", "BOX") reads as an abbreviation; leave it be.
  if (!/[a-z]/.test(word)) return word
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

const unitsPhrase = (n: number): string => `${fmt(n)} ${pluralise('unit', n)}`
const packsPhrase = (n: number, pack: string): string => `${fmt(n)} ${pluralise(pack, n)}`

function resolveLine(line: ShortageLine, uoms: ReadonlyArray<ShortageUom> | undefined): ResolvedLine {
  const uom = line.uomId != null ? uoms?.find((u) => u.id === line.uomId) : undefined
  if (uom && Number.isFinite(uom.factorToBase) && uom.factorToBase > 0) {
    if (uom.isBase) return { quantity: line.quantity, unitsPerLine: 1, packName: null }
    return { quantity: line.quantity, unitsPerLine: uom.factorToBase, packName: uom.code.trim() || null }
  }
  const pack = line.packSize ?? 1
  return {
    quantity: line.quantity,
    unitsPerLine: Number.isFinite(pack) && pack > 0 ? pack : 1,
    packName: null,
  }
}

/** One name for the pack when every line agrees on it, else the generic one. */
function packNameFor(lines: ReadonlyArray<ResolvedLine>): string {
  const first = lines[0]?.packName ?? null
  return first !== null && lines.every((l) => l.packName === first) ? first : DEFAULT_PACK_NAME
}

function unitsOnly(name: string, available: number, requested: number, maxQty: number | null): ShortageDescription {
  return {
    headline: `Only ${unitsPhrase(available)} of ${name} in stock. This order asks for ${unitsPhrase(requested)}.`,
    lineNote: `Only ${unitsPhrase(available)} in stock`,
    maxQty,
  }
}

export function describeShortage(input: ShortageInput): ShortageDescription {
  const { productName: name, requested, lines } = input
  const available = Number.isFinite(input.available) ? Math.max(0, input.available) : 0

  if (available <= 0) {
    return { headline: `${name} is out of stock.`, lineNote: 'Out of stock', maxQty: 0 }
  }

  const resolved = lines.map((l) => resolveLine(l, input.uoms))
  const counted = resolved.reduce((sum, l) => sum + l.quantity * l.unitsPerLine, 0)
  const unitsPerLine = resolved[0]?.unitsPerLine
  const readable =
    resolved.length > 0 &&
    Math.abs(counted - requested) < 1e-9 &&
    resolved.every((l) => l.unitsPerLine === unitsPerLine)

  // Several lines of one product sharing a size: the cartons that fit are a figure for
  // the PRODUCT, and which line should give way is the approver's call -- no one-tap fix,
  // except that "none fit" is the same answer for every line.
  const single = resolved.length === 1
  const fit = (perLine: number): number => Math.floor(available / perLine + 1e-9)

  if (!readable || unitsPerLine === undefined) {
    return unitsOnly(name, available, requested, null)
  }

  if (unitsPerLine === 1) {
    const whole = fit(1)
    return unitsOnly(name, available, requested, single || whole === 0 ? whole : null)
  }

  const pack = packNameFor(resolved)
  const asked = resolved.reduce((sum, l) => sum + l.quantity, 0)
  const whole = fit(unitsPerLine)
  const askedPhrase = `${packsPhrase(asked, pack)} (${unitsPhrase(requested)})`

  if (whole === 0) {
    return {
      headline:
        `None of ${name} in stock as full ${pluralise(pack, 2)} (${unitsPhrase(available)}). ` +
        `This order asks for ${askedPhrase}.`,
      lineNote: `No full ${pluralise(pack, 2)} in stock (${unitsPhrase(available)})`,
      maxQty: 0,
    }
  }

  const inStock = packsPhrase(whole, pack)
  return {
    headline: `Only ${inStock} of ${name} in stock (${unitsPhrase(available)}). This order asks for ${askedPhrase}.`,
    lineNote: `Only ${inStock} in stock (${unitsPhrase(available)})`,
    maxQty: single ? whole : null,
  }
}
