/**
 * Will this label actually scan? — the decisions in
 * supabase/functions/_shared/labels/sizing.ts.
 *
 * This module is imported by BOTH runtimes: the sizing wizard runs it in the
 * browser to show a live verdict, and generate-labels runs it on the server to
 * refuse a run. So these tests are as much about the two agreeing as about the
 * arithmetic — a threshold that lived in only one of them would let the wizard
 * promise a sheet the server then rejected.
 *
 * The measured figures pinned here are what drove the decision to move bin
 * labels off the 24-up sticker: a real Amadiya code lands at 0.31mm there and
 * 0.48mm on the 14-up.
 */
import { describe, it, expect } from 'vitest'
import {
  MIN_X_DIMENSION_MM,
  MIN_X_FOR_DISTANCE,
  fitCode,
  fitRun,
  recommendPresets,
  refuseRun,
  type ScanDistance,
} from '@/supabase/functions/_shared/labels/sizing'
import { SHEET_PRESET_INFO, SHEET_PRESETS } from '@/supabase/functions/_shared/labelSheet'

/** A real Amadiya bin code: 13 characters, no digit run long enough for Set C. */
const BIN = 'AMD-B-12-7-L3'
/** MAIN's longest shape — 15 characters. */
const LONG_BIN = 'MAIN-B-189-5-L5'
/** A handling-unit plate. The six-digit run compresses, so it is much narrower. */
const PLATE = 'HU-000123'

describe('fitCode', () => {
  it('measures a real bin code on the 24-up sticker as marginal', () => {
    // 0.31mm: above the 0.25mm floor any scanner needs, below the 0.33mm that
    // survives a scuffed label. This single number is why bin labels moved.
    const fit = fitCode(BIN, 'a4-24', 'arms_length')
    expect(fit.xDimensionMm).toBeCloseTo(0.31, 2)
    expect(fit.verdict).toBe('marginal')
    expect(fit.reason).toMatch(/0\.31mm/)
  })

  it('measures the same code on the 14-up sticker as good', () => {
    const fit = fitCode(BIN, 'a4-14', 'arms_length')
    expect(fit.xDimensionMm).toBeCloseTo(0.48, 2)
    expect(fit.verdict).toBe('good')
    expect(fit.reason).toBeNull()
  })

  it('fails a sticker too small to carry the code at all', () => {
    const fit = fitCode(BIN, 'a4-65', 'arms_length')
    expect(fit.xDimensionMm).toBeLessThan(MIN_X_DIMENSION_MM)
    expect(fit.verdict).toBe('fail')
    expect(fit.reason).toMatch(/below the 0\.25mm minimum/)
  })

  it('gets a longer code narrower bars on the same stock', () => {
    expect(fitCode(LONG_BIN, 'a4-14', 'arms_length').xDimensionMm).toBeLessThan(
      fitCode(BIN, 'a4-14', 'arms_length').xDimensionMm,
    )
  })

  it('measures the ENCODED width, not the character count', () => {
    // HU-000123 is 9 characters but its six-digit run packs two digits per
    // symbol, so it is narrower than a 9-character alphabetic code would be.
    // A character-count estimate would get this wrong.
    const plate = fitCode(PLATE, 'a4-24', 'arms_length')
    const letters = fitCode('HU-ABCDEF', 'a4-24', 'arms_length')
    expect(plate.modules).toBeLessThan(letters.modules!)
    expect(plate.xDimensionMm).toBeGreaterThan(letters.xDimensionMm)
  })

  it('reports an unencodable code as a failure rather than throwing', () => {
    // A single bad code must not take down a print run of two thousand; the
    // caller needs to be told which one and why.
    const fit = fitCode('BIN-Ω1', 'a4-14', 'arms_length')
    expect(fit.verdict).toBe('fail')
    expect(fit.modules).toBeNull()
    expect(fit.reason).toMatch(/cannot be encoded/)
    expect(fit.reason).toMatch(/Ω/)
  })

  it('gets stricter as the operator stands further back', () => {
    const distances: ScanDistance[] = ['arms_length', 'across_a_pallet', 'down_an_aisle']
    const verdicts = distances.map((d) => fitCode(BIN, 'a4-14', d).verdict)
    expect(verdicts).toEqual(['good', 'marginal', 'marginal'])
    // The requirement itself must climb monotonically, or the wizard's advice
    // would be incoherent.
    expect(MIN_X_FOR_DISTANCE.arms_length).toBeLessThan(MIN_X_FOR_DISTANCE.across_a_pallet)
    expect(MIN_X_FOR_DISTANCE.across_a_pallet).toBeLessThan(MIN_X_FOR_DISTANCE.down_an_aisle)
  })

  it('tells the operator what the distance needed, not just what it got', () => {
    const fit = fitCode(BIN, 'a4-14', 'down_an_aisle')
    expect(fit.reason).toMatch(/1mm is what/)
    expect(fit.reason).toMatch(/down an aisle/i)
  })
})

describe('fitRun', () => {
  const codes = [BIN, PLATE, LONG_BIN]

  it('judges a run by its worst label, not its average', () => {
    // A sheet is printed and stuck up as a unit. The one bin nobody can scan is
    // the one that matters.
    const run = fitRun({ codes, preset: 'a4-24', distance: 'arms_length' })
    expect(run.verdict).toBe('marginal')
    expect(run.worstCode).toBe(LONG_BIN)
    expect(run.xDimensionMm).toBeCloseTo(fitCode(LONG_BIN, 'a4-24', 'arms_length').xDimensionMm, 6)
  })

  it('counts the sheets the run will consume', () => {
    // The real cost of the move: 945 slots is 40 sheets at 24-up and 68 at 14-up.
    const many = Array.from({ length: 945 }, (_, i) => `AMD-B-${i}-1-L1`)
    expect(fitRun({ codes: many, preset: 'a4-24', distance: 'arms_length' }).sheets).toBe(40)
    expect(fitRun({ codes: many, preset: 'a4-14', distance: 'arms_length' }).sheets).toBe(68)
  })

  it('separates the labels that cannot print from those that merely should not', () => {
    const run = fitRun({ codes: [BIN, 'BIN-Ω1'], preset: 'a4-24', distance: 'arms_length' })
    expect(run.failures.map((f) => f.code)).toEqual(['BIN-Ω1'])
    expect(run.marginal.map((f) => f.code)).toEqual([BIN])
    expect(run.verdict).toBe('fail')
  })

  it('does not let an unencodable code masquerade as the narrowest bars', () => {
    // It reports 0mm, which would win a "narrowest" comparison spuriously and
    // hide the code that is genuinely at risk.
    const run = fitRun({ codes: [BIN, 'BIN-Ω1'], preset: 'a4-14', distance: 'arms_length' })
    expect(run.worstCode).toBe(BIN)
    expect(run.xDimensionMm).toBeGreaterThan(0)
  })
})

describe('recommendPresets', () => {
  const binRun = Array.from({ length: 945 }, (_, i) => `AMD-B-${i}-1-L1`)

  it('recommends the cheapest stock that actually works', () => {
    const [best] = recommendPresets({ codes: [BIN, LONG_BIN], distance: 'arms_length' })
    expect(best.verdict).toBe('good')
    expect(best.preset).toBe('a4-14')
  })

  it('prefers a smaller, cheaper sticker when the codes are short enough', () => {
    // A handling-unit plate compresses, so it does not need the big stock —
    // and the recommendation should say so rather than always reaching for it.
    const [best] = recommendPresets({ codes: [PLATE], distance: 'arms_length' })
    expect(best.verdict).toBe('good')
    expect(SHEET_PRESET_INFO[best.preset].perSheet).toBeGreaterThanOrEqual(24)
  })

  it('ranks good before marginal before fail, then by sheet count', () => {
    const ranked = recommendPresets({ codes: binRun, distance: 'arms_length' })
    const rank = { good: 0, marginal: 1, fail: 2 }
    for (let i = 1; i < ranked.length; i++) {
      const previous = rank[ranked[i - 1].verdict]
      const current = rank[ranked[i].verdict]
      expect(previous).toBeLessThanOrEqual(current)
      if (previous === current) {
        expect(ranked[i - 1].sheets).toBeLessThanOrEqual(ranked[i].sheets)
      }
    }
  })

  it('keeps the sizes that fail, so the wizard can say why not', () => {
    // An operator holding a box of the wrong labels needs to be told that, not
    // shown a list their stock is missing from.
    const ranked = recommendPresets({ codes: [LONG_BIN], distance: 'arms_length' })
    expect(ranked).toHaveLength(Object.keys(SHEET_PRESETS).length)
    expect(ranked.some((r) => r.verdict === 'fail')).toBe(true)
    expect(ranked.find((r) => r.preset === 'a4-65')!.verdict).toBe('fail')
  })

  it('offers nothing good when the operator wants to scan from down an aisle', () => {
    // The honest answer: a barcode read at several metres needs ~1mm bars, and
    // a 13-character code cannot get there on any sheet that fits on A4 twice.
    const ranked = recommendPresets({ codes: [LONG_BIN], distance: 'down_an_aisle' })
    expect(ranked.filter((r) => r.verdict === 'good')).toHaveLength(0)
  })
})

describe('refuseRun — the gate generate-labels calls before rendering', () => {
  it('permits a run that fits', () => {
    expect(refuseRun({ codes: [BIN, LONG_BIN, PLATE], preset: 'a4-14' })).toBeNull()
  })

  it('permits a merely marginal run', () => {
    // The gate judges against the ISO floor, never against a scan distance. A
    // refused run at four o'clock on-site is worse than a warned one, and the
    // wizard is where the distance advice belongs.
    const run = fitRun({ codes: [BIN], preset: 'a4-24', distance: 'arms_length' })
    expect(run.verdict).toBe('marginal')
    expect(refuseRun({ codes: [BIN], preset: 'a4-24' })).toBeNull()
  })

  it('refuses a run that cannot be read, and names the codes', () => {
    const refusal = refuseRun({ codes: [BIN, LONG_BIN], preset: 'a4-65' })
    expect(refusal).not.toBeNull()
    expect(refusal!.codes).toEqual([BIN, LONG_BIN])
    expect(refusal!.message).toContain(BIN)
  })

  it('points at a stock that would work', () => {
    // "Too long" without "use the 99mm sheet" is a dead end for whoever is
    // standing at the printer.
    const refusal = refuseRun({ codes: [BIN, LONG_BIN], preset: 'a4-65' })
    expect(refusal!.suggestion).toBe('a4-14')
    expect(refusal!.message).toContain(SHEET_PRESET_INFO['a4-14'].averyLabel)
  })

  it('refuses an unencodable code on any stock', () => {
    const refusal = refuseRun({ codes: ['BIN-Ω1'], preset: 'a4-1' })
    expect(refusal).not.toBeNull()
    expect(refusal!.message).toMatch(/cannot be encoded/)
  })

  it('summarises rather than listing two thousand codes', () => {
    const many = Array.from({ length: 300 }, (_, i) => `AMD-BULK-CHILLER-${i}`)
    const refusal = refuseRun({ codes: many, preset: 'a4-65' })
    expect(refusal!.message).toMatch(/and \d+ more/)
    expect(refusal!.message.length).toBeLessThan(600)
    // The full list still comes back for the caller to log.
    expect(refusal!.codes).toHaveLength(300)
  })

  it('says so plainly when no sheet size can help', () => {
    const absurd = 'X'.repeat(200)
    const refusal = refuseRun({ codes: [absurd], preset: 'a4-14' })
    expect(refusal!.suggestion).toBeNull()
    expect(refusal!.message).toMatch(/No available sheet size/)
  })
})
