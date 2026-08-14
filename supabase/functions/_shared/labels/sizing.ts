// Will this label actually scan? — the one module that answers it.
//
// PURE — no Deno, no pdf-lib, no I/O. Imported by BOTH runtimes: the sizing
// wizard runs it in the browser to show a live verdict, and generate-labels runs
// it on the server to refuse a run. That is the point. If the browser used its
// own copy of these thresholds, the wizard would promise a sheet the server then
// rejected, or worse, stay quiet about one it accepted. Same split, and the same
// reason, as _shared/binCount.ts and _shared/wie/replenPolicy.ts.
//
// The layering underneath: code128.ts knows modules and nothing else,
// labelSheet.ts turns a module count into points, and this turns points into a
// judgement. Only this file holds a threshold.

import {
  MIN_BAR_HEIGHT_PT,
  MM,
  type SheetPresetName,
  SHEET_PRESETS,
  SHEET_PRESET_INFO,
  labelArtwork,
  labelsPerPage,
  layoutLabels,
  sheetSpec,
} from '../labelSheet.ts'
import { Code128EncodeError, encodeCode128 } from './code128.ts'

/**
 * The absolute floor. Below this ISO 15417 does not permit the symbol and no
 * handheld reads it reliably, so a run containing one is REFUSED rather than
 * printed. A sheet of unscannable stickers is worse than no sheet: the failure
 * surfaces on a ladder, after four hundred of them are already stuck down.
 */
export const MIN_X_DIMENSION_MM = 0.25

/** How far the operator will be from the label when they pull the trigger. */
export type ScanDistance = 'arms_length' | 'across_a_pallet' | 'down_an_aisle'

/**
 * The X-dimension a standard-range gun needs at each distance.
 *
 * A laser's working range scales with bar width, so this is the question that
 * actually determines the label size — everything else in the wizard is a
 * consequence of it. `arms_length` sits above the ISO floor on purpose: 0.25mm
 * is what the standard permits, not what survives a scuffed sticker in a
 * chiller.
 */
export const MIN_X_FOR_DISTANCE: Record<ScanDistance, number> = {
  arms_length: 0.33,
  across_a_pallet: 0.5,
  down_an_aisle: 1.0,
}

export const SCAN_DISTANCE_LABELS: Record<ScanDistance, string> = {
  arms_length: "Arm's length — under 50cm",
  across_a_pallet: 'Across a pallet — about a metre',
  down_an_aisle: 'Down an aisle — several metres',
}

export type Verdict = 'good' | 'marginal' | 'fail'

export interface CodeFit {
  code: string
  /** Encoded symbol width. Null when the code cannot be encoded at all. */
  modules: number | null
  xDimensionMm: number
  barHeightMm: number
  verdict: Verdict
  /** Operator-facing explanation, or null when the fit is good. */
  reason: string | null
}

export interface RunFit {
  preset: SheetPresetName
  /** The worst verdict any single label in the run earned. */
  verdict: Verdict
  /** The widest symbol's X-dimension — the one that decides the run. */
  xDimensionMm: number
  barHeightMm: number
  /** The code that produced the narrowest bars, which is the one at risk. */
  worstCode: string
  sheets: number
  /** Labels that must not be printed at this size. */
  failures: CodeFit[]
  /** Labels that will print but are below what the scan distance wants. */
  marginal: CodeFit[]
}

function mm(points: number): number {
  return points / MM
}

/** Every cell on a sheet is the same size, so one is enough to measure against. */
function templateCell(preset: SheetPresetName) {
  return layoutLabels(1, sheetSpec(preset))[0].cells[0]
}

/**
 * How one code fares on one stock.
 *
 * Note this encodes rather than counting characters: Code Set C packs two digits
 * into one symbol, so `HU-000123` is narrower than its nine characters suggest
 * and a purely character-based estimate would be wrong in the safe direction for
 * digits and the unsafe direction for nothing — but wrong is wrong, and the
 * encoder is right here anyway.
 */
export function fitCode(
  code: string,
  preset: SheetPresetName,
  distance: ScanDistance,
  withContext = true,
): CodeFit {
  let modules: number
  try {
    modules = encodeCode128(code).modules
  } catch (error) {
    if (error instanceof Code128EncodeError) {
      return {
        code,
        modules: null,
        xDimensionMm: 0,
        barHeightMm: 0,
        verdict: 'fail',
        reason: `cannot be encoded — ${JSON.stringify(error.char)} at position ${error.index + 1}`,
      }
    }
    throw error
  }

  const art = labelArtwork(templateCell(preset), { modules, withContext })
  const xDimensionMm = mm(art.barcode.moduleWidth)
  const barHeightMm = mm(art.barcode.height)
  const needed = MIN_X_FOR_DISTANCE[distance]

  if (xDimensionMm < MIN_X_DIMENSION_MM) {
    return {
      code,
      modules,
      xDimensionMm,
      barHeightMm,
      verdict: 'fail',
      reason: `${xDimensionMm.toFixed(2)}mm bars — below the ${MIN_X_DIMENSION_MM}mm minimum any scanner can read`,
    }
  }

  if (barHeightMm < mm(MIN_BAR_HEIGHT_PT)) {
    return {
      code,
      modules,
      xDimensionMm,
      barHeightMm,
      verdict: 'fail',
      reason: `${barHeightMm.toFixed(1)}mm tall — too short for a scan line to cross reliably`,
    }
  }

  if (xDimensionMm < needed) {
    return {
      code,
      modules,
      xDimensionMm,
      barHeightMm,
      verdict: 'marginal',
      reason: `${xDimensionMm.toFixed(2)}mm bars — readable up close, but ${needed}mm is what ${SCAN_DISTANCE_LABELS[distance].toLowerCase()} needs`,
    }
  }

  return { code, modules, xDimensionMm, barHeightMm, verdict: 'good', reason: null }
}

/**
 * How a whole print run fares on one stock.
 *
 * The run is judged by its WORST label, not its average: a sheet is printed and
 * stuck up as a unit, and the one bin nobody can scan is the one that matters.
 */
export function fitRun(args: {
  codes: readonly string[]
  preset: SheetPresetName
  distance: ScanDistance
  withContext?: boolean
}): RunFit {
  const { codes, preset, distance, withContext = true } = args
  const fits = codes.map((code) => fitCode(code, preset, distance, withContext))

  const failures = fits.filter((f) => f.verdict === 'fail')
  const marginal = fits.filter((f) => f.verdict === 'marginal')

  // The narrowest bars in the run, which is the widest symbol. An unencodable
  // code reports 0 and would win this comparison spuriously, so it is excluded —
  // it is already a failure and carries its own reason.
  const measured = fits.filter((f) => f.modules !== null)
  const worst = measured.reduce<CodeFit | null>(
    (acc, f) => (acc === null || f.xDimensionMm < acc.xDimensionMm ? f : acc),
    null,
  )

  return {
    preset,
    verdict: failures.length > 0 ? 'fail' : marginal.length > 0 ? 'marginal' : 'good',
    xDimensionMm: worst?.xDimensionMm ?? 0,
    barHeightMm: worst?.barHeightMm ?? 0,
    worstCode: worst?.code ?? '',
    sheets: Math.ceil(codes.length / labelsPerPage(sheetSpec(preset))),
    failures,
    marginal,
  }
}

const VERDICT_RANK: Record<Verdict, number> = { good: 0, marginal: 1, fail: 2 }

/**
 * Every stock, ranked, for the wizard to render.
 *
 * Ordered by verdict first and then by sheet count, so the top row is the
 * cheapest stock that actually works rather than the widest one available.
 * Failing sizes are kept and returned last: "why not this one" is exactly what
 * an operator staring at a box of the wrong labels needs to be told.
 */
export function recommendPresets(args: {
  codes: readonly string[]
  distance: ScanDistance
  withContext?: boolean
  presets?: readonly SheetPresetName[]
}): RunFit[] {
  const presets = args.presets ?? (Object.keys(SHEET_PRESETS) as SheetPresetName[])
  return presets
    .map((preset) => fitRun({ ...args, preset }))
    .sort(
      (a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] || a.sheets - b.sheets,
    )
}

/**
 * The refusal gate. Returns null when the run may be printed.
 *
 * Called by generate-labels BEFORE a PDF is created, so a refusal costs nothing
 * and leaves no half-built document. It names the offending codes and points at
 * a stock that would work, because "too long" without "use the 99mm sheet" is a
 * dead end for whoever is standing at the printer.
 */
export function refuseRun(args: {
  codes: readonly string[]
  preset: SheetPresetName
  withContext?: boolean
}): { message: string; codes: string[]; suggestion: SheetPresetName | null } | null {
  // The gate judges against the ISO floor only, never against a scan distance.
  // Distance is advice the wizard gives; this is the line past which the sheet
  // is waste paper, and it must not move with a dropdown.
  const run = fitRun({ ...args, distance: 'arms_length' })
  if (run.failures.length === 0) return null

  const alternatives = recommendPresets({
    codes: args.codes,
    distance: 'arms_length',
    withContext: args.withContext,
  }).filter((r) => r.verdict !== 'fail')

  const suggestion = alternatives[0]?.preset ?? null
  const named = run.failures.slice(0, 5).map((f) => `${f.code} (${f.reason})`)
  const more = run.failures.length > named.length ? `, and ${run.failures.length - named.length} more` : ''
  const fix = suggestion
    ? ` Print these on the ${SHEET_PRESET_INFO[suggestion].averyLabel} sheet instead.`
    : ' No available sheet size fits these codes.'

  return {
    message: `${run.failures.length} label${run.failures.length === 1 ? '' : 's'} cannot be printed at this size: ${named.join('; ')}${more}.${fix}`,
    codes: run.failures.map((f) => f.code),
    suggestion,
  }
}
