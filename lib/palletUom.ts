// Turning a pallet fit into a row on a product's unit ladder — and answering,
// afterwards, where the number that ended up there came from.

import type { AppSettings, Product, ProductUom } from '../types'
import type { ExtraUomDraft } from '../components/admin/ProductUomsSection'
import { sortUoms } from './uom'
import { AU_STANDARD_PALLET, resolvePalletFit, type PalletFit, type PalletSpec } from './palletFit'

/** What the suggested row is called. Free text elsewhere; this is our default. */
export const PALLET_UOM_CODE = 'pallet'
/** Used when the base unit is itself literally called "pallet". Rare, real. */
export const PALLET_UOM_FALLBACK_CODE = 'pallet load'

/**
 * The pallet spec out of the settings row.
 *
 * Takes the RAW snake_case row, because that is what `useSettings()` returns —
 * it is not run through `toAppSettings`, and both consumers (the product form
 * and Receive Stock) read the hook directly. Also accepts a camelCase
 * `AppSettings`, so a caller holding an adapted object is not forced to
 * un-adapt it.
 *
 * Null ONLY when settings have not loaded: the panel reports that as a refusal
 * rather than computing against a pallet nobody chose. A loaded row missing the
 * columns (read before mig 00125 landed) falls back per field to the AU
 * standard the migration seeds.
 */
type SettingsRowish = Partial<AppSettings> & {
  pallet_footprint_length_mm?: number
  pallet_footprint_width_mm?: number
  pallet_base_height_mm?: number
  pallet_max_load_height_mm?: number
}

export function palletSpecFromSettings(s: SettingsRowish | null | undefined): PalletSpec | null {
  if (!s) return null
  return {
    footprintLengthMm:
      s.pallet_footprint_length_mm ?? s.palletFootprintLengthMm ?? AU_STANDARD_PALLET.footprintLengthMm,
    footprintWidthMm:
      s.pallet_footprint_width_mm ?? s.palletFootprintWidthMm ?? AU_STANDARD_PALLET.footprintWidthMm,
    baseHeightMm:
      s.pallet_base_height_mm ?? s.palletBaseHeightMm ?? AU_STANDARD_PALLET.baseHeightMm,
    maxLoadHeightMm:
      s.pallet_max_load_height_mm ?? s.palletMaxLoadHeightMm ?? AU_STANDARD_PALLET.maxLoadHeightMm,
  }
}

const isPalletCode = (code: string): boolean => {
  const c = code.trim().toLowerCase()
  return c === PALLET_UOM_CODE || c === PALLET_UOM_FALLBACK_CODE
}

/**
 * Which ladder row the carton dimensions describe: the largest non-base row
 * that is not the pallet.
 *
 * On a plain each/carton ladder that is unambiguous. On each/inner/carton it is
 * a choice, and this takes the LARGEST because a shipping carton is the outer
 * box — the thing that actually gets stacked. (Note `products.carton_size`
 * disagrees: mig 00067 syncs it from `MIN(factor_to_base)`, i.e. the innermost
 * pack. That column is the legacy ordering cache, not a statement about what is
 * on the pallet.) The product form SAYS which row it picked, so the operator
 * can see the assumption rather than discover it.
 */
export function cartonUomOf(extras: readonly ExtraUomDraft[]): ExtraUomDraft | undefined {
  let best: ExtraUomDraft | undefined
  let bestFactor = 0
  for (const u of extras) {
    if (isPalletCode(u.code)) continue
    const f = Number(u.factorToBase)
    if (!Number.isFinite(f) || f <= 1) continue
    if (f > bestFactor) {
      bestFactor = f
      best = u
    }
  }
  return best
}

/** The same choice, made against a saved product rather than a form draft. */
export function cartonUomOfProduct(product: Product | null | undefined): ProductUom | undefined {
  if (!product?.uoms) return undefined
  return sortUoms(product.uoms)
    .filter((u) => !u.isBase && !isPalletCode(u.code) && u.factorToBase > 1)
    .reduce<ProductUom | undefined>((a, b) => (!a || b.factorToBase > a.factorToBase ? b : a), undefined)
}

export function findPalletDraftIndex(extras: readonly ExtraUomDraft[]): number {
  return extras.findIndex((u) => isPalletCode(u.code))
}

/**
 * Add or update the pallet row. Pure — returns a new array.
 *
 * RECEIVABLE AND NOT ORDERABLE, deliberately, and it matters twice over. Once
 * because selling by the pallet was not asked for. And once because
 * `set_product_uoms` (mig 00067) recomputes `products.carton_size` from
 * `MIN(factor_to_base)` of the non-base ORDERABLE rows — so an orderable pallet
 * row on a product with no carton would silently redefine what a "carton" is
 * for the whole ordering side.
 *
 * It is still priced (base × factor) rather than left at zero: a zero-priced row
 * that someone later ticks Order on gives away a pallet.
 */
export function withPalletUom(
  extras: readonly ExtraUomDraft[],
  args: { factorToBase: number; baseUnitCode: string; basePrice: number },
): ExtraUomDraft[] {
  const { factorToBase, baseUnitCode, basePrice } = args
  // The base unit could itself be called "pallet", which `assembleProductUoms`
  // rejects as a duplicate code. Same trick as `deriveDefaultUomInputs`.
  const code =
    baseUnitCode.trim().toLowerCase() === PALLET_UOM_CODE
      ? PALLET_UOM_FALLBACK_CODE
      : PALLET_UOM_CODE
  const price = Number.isFinite(basePrice) ? (basePrice * factorToBase).toFixed(2) : '0'

  const index = findPalletDraftIndex(extras)
  const row: ExtraUomDraft = {
    code: index >= 0 ? extras[index].code : code,
    factorToBase: String(factorToBase),
    // An existing row keeps whatever price the admin gave it; only the quantity
    // is what this recomputes.
    price: index >= 0 ? extras[index].price : price,
    cubicMeters: index >= 0 ? extras[index].cubicMeters : '',
    isOrderable: index >= 0 ? extras[index].isOrderable : false,
    isReceivable: true,
  }
  if (index >= 0) return extras.map((u, i) => (i === index ? row : u))
  return [...extras, row]
}

/**
 * Where the pallet quantity on a product came from.
 *
 * ── WHY THIS IS RECOMPUTED, NOT STORED, AND NOT "ARE THE DIMS NULL" ─────────
 *
 * A stored flag goes stale in silence: measure the carton the day after
 * accepting an estimate and the flag still calls an exact figure a guess, with
 * nothing anywhere able to notice. This repo already refuses stored copies of
 * derivable facts for that reason (`needsRepublish` is derived in `adapters.ts`).
 *
 * "Are the carton dimensions null" is simpler and answers the WRONG question —
 * it says whether a FRESH computation would be an estimate, not where THIS
 * stored number came from. Three real states break it: an admin who edited the
 * suggested number by hand (permitted, and it is then neither); dimensions
 * filled in after an estimate was accepted; dimensions cleared after an exact
 * fit.
 *
 * So: recompute, and compare. Every stored factor lands in exactly one bucket,
 * and each bucket's sentence is true of the number in front of the operator
 * rather than of some past event.
 *
 * The one cost, stated rather than left to be discovered: change the global
 * pallet spec and every previously-`measured` row that no longer matches
 * reclassifies to `manual`. That is honest — the figure genuinely no longer
 * matches the pallet you now say you use — and it is the only signal anyone
 * would get that a spec change invalidated a catalogue's pallet quantities.
 */
export type PalletProvenance = 'measured' | 'estimated' | 'manual' | 'unknown'

export function palletProvenance(
  storedFactor: number | null | undefined,
  fit: PalletFit | null,
): PalletProvenance {
  if (storedFactor == null || !Number.isFinite(storedFactor)) return 'unknown'
  // Nothing to compare against — claim nothing rather than guess.
  if (!fit) return 'unknown'
  if (storedFactor === fit.unitsPerPallet) return fit.basis
  return 'manual'
}

/** Provenance for one row of a saved product's ladder. Non-pallet rows: unknown. */
export function uomProvenance(
  product: Product | null | undefined,
  uom: Pick<ProductUom, 'code' | 'factorToBase'> | null | undefined,
  spec: PalletSpec | null,
): PalletProvenance {
  if (!product || !uom || !isPalletCode(uom.code)) return 'unknown'
  const carton = cartonUomOfProduct(product)
  const res = resolvePalletFit({
    spec,
    cartonCm: {
      lengthCm: product.cartonLengthCm ?? null,
      widthCm: product.cartonWidthCm ?? null,
      heightCm: product.cartonHeightCm ?? null,
    },
    unitCm: {
      lengthCm: product.lengthCm ?? null,
      widthCm: product.widthCm ?? null,
      heightCm: product.heightCm ?? null,
    },
    unitsPerCarton: carton ? carton.factorToBase : null,
  })
  return palletProvenance(uom.factorToBase, res.ok ? res.fit : null)
}

/** The short label shown beside a figure. `null` means say nothing at all. */
export function provenanceLabel(p: PalletProvenance): string | null {
  switch (p) {
    case 'estimated':
      return 'Estimated'
    case 'measured':
      return 'From measured carton'
    case 'manual':
      return 'Entered by hand'
    case 'unknown':
      return null
  }
}

/** The longer sentence, for a tooltip. `null` means render no tooltip. */
export function provenanceHint(p: PalletProvenance): string | null {
  switch (p) {
    case 'estimated':
      return 'The carton was estimated from the unit size and how many fit in one, so this pallet quantity is approximate. Measure the carton on the product record to make it exact.'
    case 'measured':
      return 'Worked out from the measured carton dimensions and the standard pallet in Settings → Products.'
    case 'manual':
      return 'This figure does not match what the current carton and pallet work out to — it was entered or edited by hand, or the pallet spec has changed since.'
    case 'unknown':
      return null
  }
}
