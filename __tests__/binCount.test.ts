/**
 * Stocktake variance planning — the rules that decide what a counted number
 * does to stock.
 *
 * Covers the shared planner (supabase/functions/_shared/binCount.ts), which the
 * `count-bin` Edge Function executes and the count sheet previews, plus the
 * browser-only helpers in lib/binCount.ts. Same split, and the same reason, as
 * lib/stockAdjustment.ts vs AdjustStockModal: the maths is testable without
 * rendering anything or mocking a network.
 */
import { describe, it, expect } from 'vitest'
import {
  planCountVariance,
  systemQtyOf,
  reducibleQtyOf,
  surplusBatchFor,
  type CountSlot,
} from '@/supabase/functions/_shared/binCount'
import {
  parseCountedQty,
  entryStatus,
  describeSlots,
  describeLineResult,
  distinctLotsOf,
  sheetSummary,
  postableLines,
  predictedRefusal,
  friendlyCountError,
  type CountSheetLine,
  type CountSheetSlot,
} from '@/lib/binCount'

const slot = (over: Partial<CountSlot> = {}): CountSlot => ({
  batchId: null,
  expiryDate: null,
  onHand: 0,
  allocated: 0,
  ...over,
})

const sheetSlot = (over: Partial<CountSheetSlot> = {}): CountSheetSlot => ({
  batchId: null,
  expiryDate: null,
  onHand: 0,
  allocated: 0,
  lotCode: null,
  huId: null,
  huCode: null,
  ...over,
})

const line = (over: Partial<CountSheetLine> = {}): CountSheetLine => ({
  productId: 1,
  sku: 'AYM-1042',
  name: 'Sentinel product',
  barcode: null,
  slots: [],
  ...over,
})

describe('systemQtyOf / reducibleQtyOf', () => {
  it('sums on_hand across every lot and plate', () => {
    expect(systemQtyOf([slot({ onHand: 12 }), slot({ onHand: 12, batchId: 7 })])).toBe(24)
  })

  it('excludes allocated units from what can be removed', () => {
    const slots = [slot({ onHand: 12, allocated: 4 }), slot({ onHand: 12, batchId: 7 })]
    expect(reducibleQtyOf(slots)).toBe(20)
  })

  it('never counts an over-allocated row as negative headroom', () => {
    // allocated > on_hand should be impossible (inventory_balances_alloc_bound),
    // but a clamp here is cheaper than a wrong plan if it ever happens.
    expect(reducibleQtyOf([slot({ onHand: 2, allocated: 5 }), slot({ onHand: 10 })])).toBe(10)
  })
})

describe('surplusBatchFor', () => {
  it('attributes a surplus to the only lot holding stock', () => {
    expect(surplusBatchFor([slot({ batchId: 7, onHand: 24 })])).toBe(7)
  })

  it('spreads across plates of one lot and still names that lot', () => {
    const slots = [slot({ batchId: 7, onHand: 12 }), slot({ batchId: 7, onHand: 12 })]
    expect(surplusBatchFor(slots)).toBe(7)
  })

  it('refuses to pick between two lots', () => {
    const slots = [slot({ batchId: 7, onHand: 12 }), slot({ batchId: 9, onHand: 12 })]
    expect(surplusBatchFor(slots)).toBeNull()
  })

  it('ignores a lot that holds nothing', () => {
    const slots = [slot({ batchId: 7, onHand: 24 }), slot({ batchId: 9, onHand: 0 })]
    expect(surplusBatchFor(slots)).toBe(7)
  })

  it('is untracked when nothing is here at all (found stock)', () => {
    expect(surplusBatchFor([])).toBeNull()
  })

  it('is untracked when the only stock is itself untracked', () => {
    expect(surplusBatchFor([slot({ batchId: null, onHand: 24 })])).toBeNull()
  })
})

describe('planCountVariance — matching count', () => {
  it('plans nothing when the count agrees', () => {
    const plan = planCountVariance([slot({ onHand: 24 })], 24)
    expect(plan).toMatchObject({ ok: true, delta: 0, takes: [] })
  })
})

describe('planCountVariance — surplus', () => {
  it('books a surplus onto the single lot present', () => {
    const plan = planCountVariance([slot({ batchId: 7, onHand: 24 })], 26)
    expect(plan).toMatchObject({
      ok: true,
      delta: 2,
      takes: [{ batchId: 7, qtyDelta: 2 }],
      surplusIsUntracked: false,
    })
  })

  it('books a surplus as untracked when two lots are present, and flags it', () => {
    const slots = [
      slot({ batchId: 7, expiryDate: '2026-07-01', onHand: 12 }),
      slot({ batchId: 9, expiryDate: '2026-09-01', onHand: 12 }),
    ]
    const plan = planCountVariance(slots, 26)
    expect(plan).toMatchObject({
      ok: true,
      delta: 2,
      takes: [{ batchId: null, qtyDelta: 2 }],
      surplusIsUntracked: true,
    })
  })

  it('books found stock (nothing recorded here) as untracked', () => {
    const plan = planCountVariance([], 6)
    expect(plan).toMatchObject({
      ok: true,
      systemQty: 0,
      delta: 6,
      takes: [{ batchId: null, qtyDelta: 6 }],
      surplusIsUntracked: true,
    })
  })

  it('never refuses a surplus for lack of headroom — allocated is irrelevant upward', () => {
    const plan = planCountVariance([slot({ batchId: 7, onHand: 24, allocated: 24 })], 30)
    expect(plan.ok).toBe(true)
  })
})

describe('planCountVariance — shortfall', () => {
  it('consumes a single lot', () => {
    const plan = planCountVariance([slot({ batchId: 7, onHand: 24 })], 20)
    expect(plan).toMatchObject({ ok: true, delta: -4, takes: [{ batchId: 7, qtyDelta: -4 }] })
  })

  it('writes a line off entirely when 0 is typed', () => {
    const plan = planCountVariance([slot({ batchId: 7, onHand: 6 })], 0)
    expect(plan).toMatchObject({ ok: true, delta: -6, takes: [{ batchId: 7, qtyDelta: -6 }] })
  })

  it('consumes lots earliest-expiry-first, spilling into the next', () => {
    const slots = [
      slot({ batchId: 9, expiryDate: '2026-09-01', onHand: 12 }),
      slot({ batchId: 7, expiryDate: '2026-07-01', onHand: 12 }),
    ]
    const plan = planCountVariance(slots, 6)
    expect(plan.ok).toBe(true)
    if (plan.ok !== true) return
    expect(plan.takes).toEqual([
      { batchId: 7, qtyDelta: -12 },
      { batchId: 9, qtyDelta: -6 },
    ])
  })

  it('sorts an undated lot last — a lot with no deadline is not urgent', () => {
    const slots = [
      slot({ batchId: null, expiryDate: null, onHand: 10 }),
      slot({ batchId: 7, expiryDate: '2026-07-01', onHand: 10 }),
    ]
    const plan = planCountVariance(slots, 15)
    expect(plan.ok).toBe(true)
    if (plan.ok !== true) return
    expect(plan.takes).toEqual([{ batchId: 7, qtyDelta: -5 }])
  })

  it('merges plates of one lot into a single RPC call', () => {
    // The RPC does its own plate spread inside a batch, so emitting one take per
    // plate would call it twice for the same slot.
    const slots = [
      slot({ batchId: 7, expiryDate: '2026-07-01', onHand: 12 }),
      slot({ batchId: 7, expiryDate: '2026-07-01', onHand: 12 }),
    ]
    const plan = planCountVariance(slots, 20)
    expect(plan.ok).toBe(true)
    if (plan.ok !== true) return
    expect(plan.takes).toEqual([{ batchId: 7, qtyDelta: -4 }])
  })

  it('skips a lot whose stock is entirely reserved and takes from the next', () => {
    const slots = [
      slot({ batchId: 7, expiryDate: '2026-07-01', onHand: 12, allocated: 12 }),
      slot({ batchId: 9, expiryDate: '2026-09-01', onHand: 12 }),
    ]
    const plan = planCountVariance(slots, 20)
    expect(plan.ok).toBe(true)
    if (plan.ok !== true) return
    expect(plan.takes).toEqual([{ batchId: 9, qtyDelta: -4 }])
  })

  it('refuses the WHOLE line when the shortfall exceeds unreserved stock', () => {
    // 24 on hand, 4 reserved on lot 7 → only 20 removable, but an empty bin
    // (counted 0) needs all 24 to come off.
    const slots = [
      slot({ batchId: 7, expiryDate: '2026-07-01', onHand: 12, allocated: 4 }),
      slot({ batchId: 9, expiryDate: '2026-09-01', onHand: 12 }),
    ]
    const plan = planCountVariance(slots, 0)
    expect(plan).toEqual({
      ok: false,
      code: 'BELOW_ALLOCATED',
      systemQty: 24,
      countedQty: 0,
      reducible: 20,
    })
  })

  it('allows the deepest shortfall the reservation leaves room for', () => {
    const slots = [
      slot({ batchId: 7, expiryDate: '2026-07-01', onHand: 12, allocated: 4 }),
      slot({ batchId: 9, expiryDate: '2026-09-01', onHand: 12 }),
    ]
    const plan = planCountVariance(slots, 4)
    expect(plan.ok).toBe(true)
    if (plan.ok !== true) return
    expect(plan.takes).toEqual([
      { batchId: 7, qtyDelta: -8 },
      { batchId: 9, qtyDelta: -12 },
    ])
  })

  it('emits no takes at all on a refusal — a half-applied count is not a count', () => {
    const plan = planCountVariance([slot({ batchId: 7, onHand: 10, allocated: 8 })], 0)
    expect(plan.ok).toBe(false)
    expect(plan).not.toHaveProperty('takes')
  })

  it('allows a shortfall that lands exactly on the reserved quantity', () => {
    const plan = planCountVariance([slot({ batchId: 7, onHand: 10, allocated: 4 })], 4)
    expect(plan).toMatchObject({ ok: true, delta: -6, takes: [{ batchId: 7, qtyDelta: -6 }] })
  })
})

describe('parseCountedQty', () => {
  it('reads a whole number', () => {
    expect(parseCountedQty('24')).toBe(24)
    expect(parseCountedQty('  0 ')).toBe(0)
  })

  it('treats blank as uncounted, NOT as zero', () => {
    expect(parseCountedQty('')).toBeNull()
    expect(parseCountedQty('   ')).toBeNull()
  })

  it('rejects anything that is not a tally', () => {
    for (const bad of ['-3', '2.5', 'twelve', '1e3', '+4']) {
      expect(parseCountedQty(bad)).toBeUndefined()
    }
  })
})

describe('entryStatus', () => {
  const l = line({ slots: [sheetSlot({ batchId: 7, onHand: 24 })] })

  it('classifies each kind of entry', () => {
    expect(entryStatus(l, '')).toBe('blank')
    expect(entryStatus(l, 'x')).toBe('invalid')
    expect(entryStatus(l, '24')).toBe('match')
    expect(entryStatus(l, '26')).toBe('surplus')
    expect(entryStatus(l, '20')).toBe('shortfall')
  })
})

describe('describeSlots', () => {
  it('names lot and plate for each stocked row', () => {
    const slots = [
      sheetSlot({ batchId: 7, lotCode: 'L2026-07', onHand: 12, huId: 88, huCode: 'PLT-88' }),
      sheetSlot({ batchId: 9, lotCode: 'L2026-09', onHand: 12 }),
    ]
    expect(describeSlots(slots)).toBe('L2026-07 ×12 on PLT-88 · L2026-09 ×12 loose')
  })

  it('says so when the system believes the bin holds none of it', () => {
    expect(describeSlots([sheetSlot({ batchId: 7, onHand: 0 })])).toBe('nothing recorded here')
    expect(describeSlots([])).toBe('nothing recorded here')
  })
})

describe('sheetSummary / postableLines', () => {
  const lines: CountSheetLine[] = [
    line({ productId: 1, slots: [sheetSlot({ batchId: 7, onHand: 24 })] }),
    line({ productId: 2, slots: [sheetSlot({ batchId: 8, onHand: 12 })] }),
    line({ productId: 3, slots: [sheetSlot({ batchId: 9, onHand: 6 })] }),
    line({ productId: 4, slots: [sheetSlot({ batchId: 10, onHand: 10, allocated: 8 })] }),
  ]
  // 1: shortfall −4, 2: untouched, 3: written off −6, 4: refused
  const counts = { 1: '20', 2: '', 3: '0', 4: '0' }

  it('counts every category and nets the units that will actually move', () => {
    expect(sheetSummary(lines, counts)).toEqual({
      variances: 3, surplus: 0, shortfall: 3, matched: 0,
      blank: 1, invalid: 0, blocked: 1, netUnits: -10,
    })
  })

  it('sends only lines that differ, and never a blank one', () => {
    expect(postableLines(lines, counts)).toEqual([
      { productId: 1, countedQty: 20 },
      { productId: 3, countedQty: 0 },
      { productId: 4, countedQty: 0 },
    ])
  })

  it('drops a typed number that merely confirms the system', () => {
    expect(postableLines(lines, { 1: '24' })).toEqual([])
  })
})

describe('describeLineResult — untracked surplus wording', () => {
  const posted = { productId: 1, systemQty: 10, countedQty: 13, delta: 3, ok: true, surplusIsUntracked: true }

  it('says WHY when several lots are held', () => {
    expect(describeLineResult(posted, 2)).toContain('more than one lot is held here')
  })

  it('does not claim several lots when the stock carries none', () => {
    // The live WIE-DEMO case: a bin holding untracked stock takes an untracked
    // surplus, and the old copy explained it as a multi-lot ambiguity that had
    // not happened.
    const message = describeLineResult(posted, 0)
    expect(message).toContain('no lot is recorded')
    expect(message).not.toContain('more than one lot')
  })

  it('says nothing at all about a surplus attributed to its lot', () => {
    expect(describeLineResult({ ...posted, surplusIsUntracked: false }, 1)).toBeNull()
  })
})

describe('distinctLotsOf', () => {
  it('counts only lots actually holding stock', () => {
    expect(distinctLotsOf(line({ slots: [
      sheetSlot({ batchId: 7, onHand: 12 }),
      sheetSlot({ batchId: 7, onHand: 12 }),
      sheetSlot({ batchId: 9, onHand: 0 }),
      sheetSlot({ batchId: null, onHand: 5 }),
    ] }))).toBe(1)
  })

  it('is zero for wholly untracked stock', () => {
    expect(distinctLotsOf(line({ slots: [sheetSlot({ batchId: null, onHand: 10 })] }))).toBe(0)
  })
})

describe('friendlyCountError / predictedRefusal', () => {
  it('names the numbers and what to do, not the error code', () => {
    const message = friendlyCountError(line(), { countedQty: 18, systemQty: 24, reducible: 20 })
    expect(message).toContain('4 of 24 units are reserved')
    expect(message).toContain('only 20 can be removed')
    expect(message).toContain('re-count this line')
    expect(message).not.toContain('BELOW_ALLOCATED')
  })

  it('predicts a refusal from the sheet before anything is sent', () => {
    // 10 on hand, 8 reserved → only 2 removable, so any count below 8 bounces.
    const l = line({ slots: [sheetSlot({ batchId: 7, onHand: 10, allocated: 8 })] })
    expect(predictedRefusal(l, '0')).toContain('reserved for open orders')
    expect(predictedRefusal(l, '8')).toBeNull()
    expect(predictedRefusal(l, '')).toBeNull()
  })
})
