// How many units ride on a pallet — worked out from the box, not typed in.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Receiving lets an operator count in any of the product's UOMs, but nothing
// in the catalogue ever said how many units are on a pallet, so nobody could
// count in pallets. Worse, `wie_replen_config_rows` (mig 00118) INFERS
// units-per-pallet as `MAX(factor_to_base)` — positional guesswork — because
// there was no declared figure to read. Giving a product a real Pallet UOM
// fixes both, and the number behind it should come from the carton and the
// pallet rather than from someone's memory.
//
// ── WHY IT IS BROWSER-ONLY, NOT `_shared/` ──────────────────────────────────
//
// The repo's shared-module rule (`_shared/binCount.ts`, `_shared/wie/*`) exists
// where the client PREVIEWS a decision the server will re-make, and the two
// must be the same code or they disagree. Nothing like that happens here: the
// admin confirms a number, and it is stored as an ordinary `product_uoms`
// factor that `validateUoms` already checks. The server never computes a pallet
// fit, so a `_shared` copy would be imported by nothing on the Deno side.
//
// It is dependency-free and takes plain numbers, so if a future job needs a
// "re-fit every product" batch it lifts to `_shared/palletFit.ts` with a
// `lib/` re-export and no edit.
//
// ── MILLIMETRES INSIDE, ALWAYS ──────────────────────────────────────────────
//
// Every dimension is converted to integer mm at the boundary. `1165` is exact
// in mm and 116.5 in cm, and the whole computation is a stack of `floor()`s —
// a value one part in a million short loses an entire carton off a layer.

/** A box, in whole millimetres. */
export interface BoxMm {
  lengthMm: number
  widthMm: number
  heightMm: number
}

/** The pallet every product is fitted against. One global spec (app_settings). */
export interface PalletSpec {
  footprintLengthMm: number
  footprintWidthMm: number
  /** The pallet's own deck height. Reported, never an input — see MAX LOAD. */
  baseHeightMm: number
  /**
   * How tall the GOODS may stack, excluding the pallet itself. Already
   * load-only, which is why `baseHeightMm` is not subtracted from it anywhere.
   * Subtracting it would count the deck twice.
   */
  maxLoadHeightMm: number
}

/** Australian standard pallet: 1165 × 1165, 150 mm deck, 1650 mm of load. */
export const AU_STANDARD_PALLET: PalletSpec = {
  footprintLengthMm: 1165,
  footprintWidthMm: 1165,
  baseHeightMm: 150,
  maxLoadHeightMm: 1650,
}

/** Was the carton measured, or inferred from the unit? Never hidden. */
export type CartonBasis = 'measured' | 'estimated'

/** Board thickness and packing slack, added to each edge of an estimate. */
export const CARTON_WALL_ALLOWANCE = 0.05

/**
 * Guards the arrangement search. A mistyped units-per-carton (a pasted SKU, a
 * stray zero) must refuse rather than enumerate for a second and a half.
 */
export const MAX_UNITS_PER_CARTON = 10_000

/** cm as an operator types it → whole mm. See "MILLIMETRES INSIDE". */
export function cmToMm(cm: number): number {
  return Math.round(cm * 10)
}

export interface CartonEstimate {
  box: BoxMm
  unitsPerCarton: number
  /** Units laid along each axis: [across, deep, high]. */
  arrangement: [number, number, number]
  /** The box before the wall allowance, so the working can show both. */
  bareMm: BoxMm
  wallAllowance: number
  /** How many arrangements were compared, for the "best of N" line. */
  candidatesConsidered: number
}

/**
 * Every way `n` divides into three whole factors, as sorted triples so
 * 2×3×4 and 4×3×2 are considered once.
 */
export function factorTriples(n: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  if (!Number.isInteger(n) || n < 1 || n > MAX_UNITS_PER_CARTON) return out
  for (let a = 1; a * a * a <= n; a++) {
    if (n % a !== 0) continue
    const rest = n / a
    for (let b = a; b * b <= rest; b++) {
      if (rest % b !== 0) continue
      out.push([a, b, rest / b])
    }
  }
  return out
}

/**
 * The most cube-like packing of `n` units, as the estimated carton.
 *
 * Volume is IDENTICAL across every candidate — it is always `n` × the unit box
 * — so "most cube-like" reduces to MINIMUM SURFACE AREA. One metric, nothing to
 * weight, and it is the same thing a packaging engineer optimises for (least
 * board per unit). Ties break on the edge ratio and then lexicographically, so
 * the answer is deterministic and the form can show its working.
 *
 * The unit keeps its own orientation; only how many go along each axis varies.
 * Tumbling the unit as well would search six times as much for a box the
 * operator could no longer check against the one in their hand.
 *
 * Returns null when it has nothing to work from — never a guess dressed as one.
 */
export function estimateCartonBox(unit: BoxMm, unitsPerCarton: number): CartonEstimate | null {
  const { lengthMm: uL, widthMm: uW, heightMm: uH } = unit
  if (![uL, uW, uH].every((v) => Number.isFinite(v) && v > 0)) return null
  const triples = factorTriples(unitsPerCarton)
  if (triples.length === 0) return null

  let best: { arr: [number, number, number]; box: BoxMm; area: number; ratio: number } | null = null

  for (const t of triples) {
    // Each sorted triple can be assigned to the three axes six ways, and they
    // give genuinely different boxes once the unit is not a cube.
    for (const [a, b, c] of permutations(t)) {
      const box: BoxMm = { lengthMm: a * uL, widthMm: b * uW, heightMm: c * uH }
      const area = surfaceArea(box)
      const dims = [box.lengthMm, box.widthMm, box.heightMm]
      const ratio = Math.max(...dims) / Math.min(...dims)
      if (
        best === null ||
        area < best.area - 1e-9 ||
        (Math.abs(area - best.area) < 1e-9 && ratio < best.ratio - 1e-9)
      ) {
        best = { arr: [a, b, c], box, area, ratio }
      }
    }
  }
  if (!best) return null

  const grow = (v: number) => Math.round(v * (1 + CARTON_WALL_ALLOWANCE))
  return {
    box: {
      lengthMm: grow(best.box.lengthMm),
      widthMm: grow(best.box.widthMm),
      heightMm: grow(best.box.heightMm),
    },
    bareMm: best.box,
    unitsPerCarton,
    arrangement: best.arr,
    wallAllowance: CARTON_WALL_ALLOWANCE,
    candidatesConsidered: triples.length,
  }
}

function surfaceArea(b: BoxMm): number {
  return 2 * (b.lengthMm * b.widthMm + b.lengthMm * b.heightMm + b.widthMm * b.heightMm)
}

function permutations([a, b, c]: [number, number, number]): Array<[number, number, number]> {
  const all: Array<[number, number, number]> = [
    [a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a],
  ]
  // De-dupe so a triple like 2×2×3 is not scored four times identically.
  const seen = new Set<string>()
  return all.filter((p) => {
    const k = p.join('x')
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export type PalletFitRefusal =
  | 'no_pallet_spec'
  | 'no_carton_box'
  | 'no_units_per_carton'
  | 'units_per_carton_too_large'
  | 'carton_footprint_exceeds_pallet'
  | 'carton_taller_than_max_load'

export interface PalletFit {
  perLayer: number
  layers: number
  cartonsPerPallet: number
  unitsPerPallet: number
  /** Which 90° turn won, so the working can say "turned 90°". */
  orientation: 'as_measured' | 'rotated'
  /** The two floor()s behind `perLayer`, for the same reason. */
  alongLength: number
  alongWidth: number
  loadHeightMm: number
  headroomMm: number
  carton: BoxMm
  unitsPerCarton: number
  basis: CartonBasis
}

/**
 * Both members carry BOTH keys, one of them optional-undefined.
 *
 * `strict` is off in this repo, which cripples discriminated-union narrowing:
 * `res.ok ? res.fit : res.reason` fails to compile even though the discriminant
 * is a boolean literal. Declaring the absent half as `?: undefined` keeps the
 * union honest — `fit` is still only present when `ok` — while letting callers
 * read either key without a cast. See CLAUDE.md, "tsconfig strict-off union
 * narrowing".
 */
export type PalletFitResult =
  | { ok: true; fit: PalletFit; reason?: undefined }
  | { ok: false; fit?: undefined; reason: PalletFitRefusal }

/**
 * Cartons per pallet, by the plainest rule that is checkable by eye.
 *
 * Two orientations per layer, the better one wins; layers are whole cartons
 * inside the max load height. No pinwheel or mixed-orientation layers: they fit
 * more, and they stop being a number an operator can verify against the pallet
 * in front of them. No overhang allowance either — a carton that does not fit
 * the deck is REFUSED BY NAME rather than quietly permitted to hang over.
 *
 * A zero is never returned. `unitsPerPallet: 0` offered as a UOM factor is the
 * worst outcome available here, so both zero cases are named refusals.
 */
export function computePalletFit(args: {
  spec: PalletSpec
  carton: BoxMm
  unitsPerCarton: number
  basis: CartonBasis
}): PalletFitResult {
  const { spec, carton, unitsPerCarton, basis } = args
  if (!Number.isInteger(unitsPerCarton) || unitsPerCarton < 1) {
    return { ok: false, reason: 'no_units_per_carton' }
  }
  if (unitsPerCarton > MAX_UNITS_PER_CARTON) {
    return { ok: false, reason: 'units_per_carton_too_large' }
  }
  if (![carton.lengthMm, carton.widthMm, carton.heightMm].every((v) => Number.isFinite(v) && v > 0)) {
    return { ok: false, reason: 'no_carton_box' }
  }
  if (
    ![spec.footprintLengthMm, spec.footprintWidthMm, spec.maxLoadHeightMm].every(
      (v) => Number.isFinite(v) && v > 0,
    )
  ) {
    return { ok: false, reason: 'no_pallet_spec' }
  }

  const asMeasuredL = Math.floor(spec.footprintLengthMm / carton.lengthMm)
  const asMeasuredW = Math.floor(spec.footprintWidthMm / carton.widthMm)
  const rotatedL = Math.floor(spec.footprintLengthMm / carton.widthMm)
  const rotatedW = Math.floor(spec.footprintWidthMm / carton.lengthMm)

  const asMeasured = asMeasuredL * asMeasuredW
  const rotated = rotatedL * rotatedW
  const perLayer = Math.max(asMeasured, rotated)
  if (perLayer < 1) return { ok: false, reason: 'carton_footprint_exceeds_pallet' }

  const layers = Math.floor(spec.maxLoadHeightMm / carton.heightMm)
  if (layers < 1) return { ok: false, reason: 'carton_taller_than_max_load' }

  const useRotated = rotated > asMeasured
  const cartonsPerPallet = perLayer * layers
  const loadHeightMm = layers * carton.heightMm

  return {
    ok: true,
    fit: {
      perLayer,
      layers,
      cartonsPerPallet,
      unitsPerPallet: cartonsPerPallet * unitsPerCarton,
      orientation: useRotated ? 'rotated' : 'as_measured',
      alongLength: useRotated ? rotatedL : asMeasuredL,
      alongWidth: useRotated ? rotatedW : asMeasuredW,
      loadHeightMm,
      headroomMm: spec.maxLoadHeightMm - loadHeightMm,
      carton,
      unitsPerCarton,
      basis,
    },
  }
}

/** Same both-keys shape as `PalletFitResult`, and for the same reason. */
export type ResolvedPalletFit =
  | { ok: true; fit: PalletFit; estimate: CartonEstimate | null; reason?: undefined }
  | { ok: false; fit?: undefined; estimate?: undefined; reason: PalletFitRefusal }

/**
 * The whole pipeline the product form drives: use the measured carton when
 * there is one, otherwise estimate it from the unit, then fit. One call, one
 * result, one refusal vocabulary.
 */
export function resolvePalletFit(args: {
  spec: PalletSpec | null
  /** cm as typed on the form; any null means "not measured". */
  cartonCm: { lengthCm: number | null; widthCm: number | null; heightCm: number | null }
  unitCm: { lengthCm: number | null; widthCm: number | null; heightCm: number | null }
  unitsPerCarton: number | null
}): ResolvedPalletFit {
  const { spec, cartonCm, unitCm, unitsPerCarton } = args
  if (!spec) return { ok: false, reason: 'no_pallet_spec' }
  if (unitsPerCarton == null || !Number.isInteger(unitsPerCarton) || unitsPerCarton < 1) {
    return { ok: false, reason: 'no_units_per_carton' }
  }

  const measured = toBoxMm(cartonCm.lengthCm, cartonCm.widthCm, cartonCm.heightCm)
  if (measured) {
    const res = computePalletFit({ spec, carton: measured, unitsPerCarton, basis: 'measured' })
    return res.ok ? { ok: true, fit: res.fit, estimate: null } : { ok: false, reason: res.reason }
  }

  const unit = toBoxMm(unitCm.lengthCm, unitCm.widthCm, unitCm.heightCm)
  if (!unit) return { ok: false, reason: 'no_carton_box' }
  const estimate = estimateCartonBox(unit, unitsPerCarton)
  if (!estimate) return { ok: false, reason: 'no_carton_box' }

  const res = computePalletFit({ spec, carton: estimate.box, unitsPerCarton, basis: 'estimated' })
  return res.ok ? { ok: true, fit: res.fit, estimate } : { ok: false, reason: res.reason }
}

function toBoxMm(
  lengthCm: number | null,
  widthCm: number | null,
  heightCm: number | null,
): BoxMm | null {
  const vals = [lengthCm, widthCm, heightCm]
  if (!vals.every((v) => v != null && Number.isFinite(v) && (v as number) > 0)) return null
  return {
    lengthMm: cmToMm(lengthCm as number),
    widthMm: cmToMm(widthCm as number),
    heightMm: cmToMm(heightCm as number),
  }
}

/** Why there is no figure — said in the operator's terms, never as a zero. */
export function describeRefusal(reason: PalletFitRefusal, spec?: PalletSpec | null): string {
  switch (reason) {
    case 'no_pallet_spec':
      return 'No pallet size is set. Add one in Settings → Products to work out pallet quantities.'
    case 'no_carton_box':
      return 'Needs either the carton dimensions, or the unit dimensions to estimate them from.'
    case 'no_units_per_carton':
      return 'Needs a carton unit on the product’s unit ladder, so there is a pack to stack.'
    case 'units_per_carton_too_large':
      return `A carton of more than ${MAX_UNITS_PER_CARTON.toLocaleString()} units looks like a typo — check the unit ladder.`
    case 'carton_footprint_exceeds_pallet':
      return spec
        ? `The carton is wider than the ${spec.footprintLengthMm} × ${spec.footprintWidthMm} mm pallet in both orientations, so none fit on a layer.`
        : 'The carton is wider than the pallet in both orientations, so none fit on a layer.'
    case 'carton_taller_than_max_load':
      return spec
        ? `The carton is taller than the ${spec.maxLoadHeightMm} mm the load may stack to, so not even one layer fits.`
        : 'The carton is taller than the load may stack to, so not even one layer fits.'
  }
}

/** "40 × 30 × 25 cm" from a box in mm, for the working and the summary. */
export function formatBoxCm(box: BoxMm): string {
  const cm = (mm: number) => Number((mm / 10).toFixed(1)).toString()
  return `${cm(box.lengthMm)} × ${cm(box.widthMm)} × ${cm(box.heightMm)} cm`
}
