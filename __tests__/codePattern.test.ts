// Operator-controlled location codes — the pure engine.
//
// Four properties here are load-bearing and none is enforced by the database:
//
//   1. BACKWARDS COMPATIBILITY. The built-in pattern must reproduce today's code
//      byte-for-byte, or "no row = built-in default" silently renames a live site.
//   2. `normalizeScan` UPPERCASES, so `AMD-A01` and `AMD-a01` are two rows to the
//      global UNIQUE constraint and ONE key to `resolveScan`. Codes are uppercase
//      only, and collisions are judged case-insensitively on top of that.
//   3. `barcodeVariants` zero-pads any digits-only string to GTIN-8/12/13/14, so a
//      digits-only bin code folds onto a product barcode and makes every scan of
//      that bin `ambiguous`.
//   4. IDEMPOTENCE — re-running the identical sweep must write nothing. That is the
//      proof the numbering rule is total, and it is what lets the server retry.

import { describe, it, expect } from 'vitest'
import {
  BUILTIN_PATTERN,
  MAX_CODE_LENGTH,
  WIZARD_DEFAULT_PATTERN,
  buildSelectionFrame,
  codeIssue,
  formatCode,
  frameKey,
  levelCodeFor,
  orderCells,
  planRecode,
  sanitizeBlock,
  solveBlockFraming,
  styleOfTemplate,
  templateForStyle,
  templateIssue,
  usedTokens,
  type RecodeUnit,
  type SelectionFrame,
} from '@/lib/codePattern'
import { levelCode } from '@/components/warehouse/levels/rackLevels'

const bind = (over: Partial<Parameters<typeof formatCode>[1]> = {}) => ({
  wh: 'AMD', block: 'B', x: 3, y: 4, n: null, floor: 0, ...over,
})

const unit = (id: number, x: number, y: number, code: string, over: Partial<RecodeUnit> = {}): RecodeUnit => ({
  id, floor: 0, x, y, code, codeBlock: null, codeSeq: null, ...over,
})

// ───────────────────────────────────────────────────────────── compatibility ──

describe('BUILTIN_PATTERN', () => {
  // The migration-safety test. `warehouse_code_patterns` has no row for any site,
  // so every warehouse resolves to this — and it must be a no-op.
  it.each([
    [0, 0, 'AMD-B-0-0'],
    [3, 4, 'AMD-B-3-4'],
    [12, 7, 'AMD-B-12-7'],
    [189, 5, 'AMD-B-189-5'],
  ])('reproduces the historical grid code at (%i,%i)', (x, y, expected) => {
    expect(formatCode(BUILTIN_PATTERN.template, bind({ x, y, block: BUILTIN_PATTERN.defaultBlock })))
      .toBe(expected)
  })

  it('is accepted by its own validator', () => {
    expect(templateIssue(BUILTIN_PATTERN.template)).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────── templates ──

describe('formatCode', () => {
  it('substitutes every token', () => {
    expect(formatCode('{wh}-{block}-{x}-{y}-F{floor}', bind({ block: 'COLD', floor: 2 })))
      .toBe('AMD-COLD-3-4-F2')
  })

  it('pads numeric tokens to the width in the token', () => {
    expect(formatCode('{wh}-{n:03}', bind({ n: 7 }))).toBe('AMD-007')
    expect(formatCode('{wh}-{x:02}-{y:02}', bind())).toBe('AMD-03-04')
  })

  it('does not truncate a number wider than its padding', () => {
    // Dropping a digit changes which bin the code names. Never truncate.
    expect(formatCode('{n:02}', bind({ n: 1234 }))).toBe('1234')
  })

  it('slugs the block', () => {
    expect(formatCode('{wh}-{block}-{n:02}', bind({ block: 'Cold A', n: 3 }))).toBe('AMD-COLD-A-03')
  })

  it('drops an absent token and collapses its separator', () => {
    expect(formatCode('{wh}-{block}-{n:02}', bind({ block: '', n: 3 }))).toBe('AMD-03')
    expect(formatCode('{wh}-{block}-{n:02}', bind({ block: 'X', n: null }))).toBe('AMD-X')
  })

  it('keeps literal text verbatim', () => {
    expect(formatCode('AMD-COLD-A-{n:02}', bind({ n: 9 }))).toBe('AMD-COLD-A-09')
  })
})

describe('sanitizeBlock', () => {
  it('uppercases and hyphenates', () => {
    expect(sanitizeBlock('Cold a')).toBe('COLD-A')
  })

  it('strips characters a code may not carry', () => {
    expect(sanitizeBlock('Bulk / 50%')).toBe('BULK-50')
  })

  it('strips the LIKE metacharacter underscore', () => {
    // Every path scope check in the system is `LIKE '<path>/%'`, where `_` matches
    // any single character. A code carrying one widens somebody else's query.
    expect(sanitizeBlock('COLD_A')).toBe('COLD-A')
  })

  it('collapses and trims separator runs', () => {
    expect(sanitizeBlock('  Fast   Movers  ')).toBe('FAST-MOVERS')
  })

  it('is idempotent', () => {
    for (const raw of ['Cold a', 'Bulk / 50%', 'COLD_A', '  x  ', 'A--B']) {
      expect(sanitizeBlock(sanitizeBlock(raw))).toBe(sanitizeBlock(raw))
    }
  })

  it('returns empty for a block with nothing usable in it', () => {
    expect(sanitizeBlock('///')).toBe('')
  })
})

describe('templateIssue', () => {
  it('accepts every known token', () => {
    expect(templateIssue('{wh}-{block}-{x:02}-{y:02}-{n:03}-{floor}')).toBeNull()
  })

  it('rejects an unknown token', () => {
    expect(templateIssue('{wh}-{aisle}')).toMatch(/aisle/)
  })

  it('rejects an unclosed brace', () => {
    expect(templateIssue('{wh}-{n')).toBeTruthy()
  })

  it('rejects padding on a text token', () => {
    expect(templateIssue('{wh:02}-{n}')).toBeTruthy()
  })

  it('rejects a blank template', () => {
    expect(templateIssue('   ')).toBeTruthy()
  })

  it('rejects a literal path separator — the code is a materialized_path segment', () => {
    expect(templateIssue('{wh}/{n}')).toBeTruthy()
  })
})

// ──────────────────────────────────────────────────────────────── validation ──

describe('codeIssue', () => {
  it('passes an ordinary code', () => {
    expect(codeIssue('AMD-COLD-A-01')).toBeNull()
  })

  // Every shape currently on MAIN and AMADIYA must survive, or step 2 of the
  // rollout (validating existing write paths) would refuse a live code.
  it.each(['AMD-B-12-7', 'AMD-B-12-7-L3', 'NEXG-B-9-4-L4', 'MAIN', 'AMD-P-3-4-F1'])(
    'accepts the legacy code %s', (code) => {
      expect(codeIssue(code)).toBeNull()
    },
  )

  it('refuses empty', () => {
    expect(codeIssue('')).toBe('empty')
    expect(codeIssue('   ')).toBe('empty')
  })

  it(`refuses longer than ${MAX_CODE_LENGTH}`, () => {
    expect(codeIssue('A'.repeat(MAX_CODE_LENGTH))).toBeNull()
    expect(codeIssue('A'.repeat(MAX_CODE_LENGTH + 1))).toBe('too_long')
  })

  it('refuses a path separator', () => {
    expect(codeIssue('AMD/A01')).toBe('path_separator')
  })

  it('refuses LIKE metacharacters', () => {
    expect(codeIssue('AMD-50%')).toBe('like_wildcard')
    expect(codeIssue('AMD_A01')).toBe('like_wildcard')
  })

  it('refuses lowercase — resolveScan folds it, so two rows would scan alike', () => {
    expect(codeIssue('amd-a01')).toBe('charset')
  })

  it('refuses anything outside the allowed set', () => {
    expect(codeIssue('AMD-Ā01')).toBe('charset')
    expect(codeIssue('AMD A01')).toBe('charset')
    expect(codeIssue('AMD\tA01')).toBe('charset')
  })

  it('refuses the parking prefix the recode transaction reserves', () => {
    expect(codeIssue('~RECODE~123')).toBe('reserved')
  })

  it('refuses the handling-unit namespace (mig 00074)', () => {
    expect(codeIssue('HU-000123')).toBe('reserved')
  })

  it('refuses a digits-only code — barcodeVariants would fold it onto a GTIN', () => {
    expect(codeIssue('0304')).toBe('numeric_only')
    expect(codeIssue('9312345678907')).toBe('numeric_only')
  })

  it('allows digits once any letter is present', () => {
    expect(codeIssue('A0304')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────── ordering ──

describe('orderCells', () => {
  //  (0,0) (1,0) (2,0)
  //  (0,1) (1,1) (2,1)
  const grid = [
    { x: 2, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 },
    { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 },
  ].map((c) => ({ ...c, floor: 0 }))
  const seen = (o: Parameters<typeof orderCells>[1]) =>
    orderCells(grid, o).map((c) => `${c.x},${c.y}`)

  it('row-major runs left to right, top to bottom', () => {
    expect(seen('row')).toEqual(['0,0', '1,0', '2,0', '0,1', '1,1', '2,1'])
  })

  it('column-major runs top to bottom, left to right', () => {
    expect(seen('column')).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1'])
  })

  it('serpentine rows reverse every other row — real walk order', () => {
    expect(seen('serpentine-row')).toEqual(['0,0', '1,0', '2,0', '2,1', '1,1', '0,1'])
  })

  it('serpentine columns reverse every other column', () => {
    expect(seen('serpentine-column')).toEqual(['0,0', '0,1', '1,1', '1,0', '2,0', '2,1'])
  })

  it('alternates by position in the sequence, not by raw coordinate parity', () => {
    // A selection starting at y=7 must still begin forwards.
    const offset = [{ x: 0, y: 7 }, { x: 1, y: 7 }, { x: 0, y: 8 }, { x: 1, y: 8 }]
      .map((c) => ({ ...c, floor: 0 }))
    expect(orderCells(offset, 'serpentine-row').map((c) => `${c.x},${c.y}`))
      .toEqual(['0,7', '1,7', '1,8', '0,8'])
  })

  it('orders floors outermost — a walk cannot cross one', () => {
    const out = orderCells([{ floor: 1, x: 0, y: 0 }, { floor: 0, x: 9, y: 9 }], 'row')
    expect(out[0].floor).toBe(0)
  })

  it('is deterministic under a shuffled input', () => {
    const shuffled = [...grid].reverse()
    expect(orderCells(shuffled, 'row')).toEqual(orderCells(grid, 'row'))
  })
})

describe('levelCodeFor', () => {
  it('appends the -L suffix the rest of the system already parses', () => {
    expect(levelCodeFor('AMD-COLD-A-01', 3)).toBe('AMD-COLD-A-01-L3')
  })

  // One definition, not two. Forking a string composer is the hazard scanNormalize
  // and signPaint both document.
  it('is the same function rackLevels exports', () => {
    expect(levelCode('AMD-COLD-A-01', 3)).toBe(levelCodeFor('AMD-COLD-A-01', 3))
  })
})

// ────────────────────────────────────────────────────────────────── planning ──

const opts = (over: Partial<Parameters<typeof planRecode>[1]> = {}) => ({
  template: '{wh}-{block}-{n:02}',
  block: 'COLD-A',
  start: 1,
  order: 'row' as const,
  wh: 'AMD',
  takenCodes: new Map<string, number>(),
  ...over,
})

describe('planRecode', () => {
  it('numbers a block in traversal order from the start value', () => {
    const plan = planRecode(
      [unit(1, 0, 0, 'AMD-B-0-0'), unit(2, 1, 0, 'AMD-B-1-0'), unit(3, 0, 1, 'AMD-B-0-1')],
      opts(),
    )
    expect(plan.refusals).toEqual([])
    expect(plan.writes.map((w) => w.to)).toEqual(['AMD-COLD-A-01', 'AMD-COLD-A-02', 'AMD-COLD-A-03'])
    expect(plan.writes.map((w) => w.seq)).toEqual([1, 2, 3])
    expect(plan.nextCounter).toBe(4)
  })

  it('honours a start value other than 1', () => {
    expect(planRecode([unit(1, 0, 0, 'X')], opts({ start: 17 })).writes[0].to).toBe('AMD-COLD-A-17')
  })

  it('stamps the pool key and the number on every write', () => {
    const plan = planRecode([unit(1, 0, 0, 'X')], opts())
    expect(plan.writes[0].codeBlock).toBe('COLD-A')
    expect(plan.writes[0].seq).toBe(1)
  })

  it('derives every level code from the new rack code, preserving indexes through a gap', () => {
    const rack = unit(1, 0, 0, 'AMD-B-0-0', {
      levels: [
        { id: 11, levelIndex: 1, code: 'AMD-B-0-0-L1' },
        { id: 12, levelIndex: 2, code: 'AMD-B-0-0-L2' },
        { id: 14, levelIndex: 4, code: 'AMD-B-0-0-L4' },
      ],
    })
    expect(planRecode([rack], opts()).writes[0].levels.map((l) => l.to))
      .toEqual(['AMD-COLD-A-01-L1', 'AMD-COLD-A-01-L2', 'AMD-COLD-A-01-L4'])
  })

  // Idempotence. The second run must be a no-op or the server cannot safely retry.
  it('reports an already-swept block as unchanged and writes nothing', () => {
    const already = [
      unit(1, 0, 0, 'AMD-COLD-A-01', { codeBlock: 'COLD-A', codeSeq: 1 }),
      unit(2, 1, 0, 'AMD-COLD-A-02', { codeBlock: 'COLD-A', codeSeq: 2 }),
    ]
    const plan = planRecode(already, opts())
    expect(plan.writes).toEqual([])
    expect(plan.unchanged).toBe(2)
    expect(plan.refusals).toEqual([])
  })

  it('rewrites a row whose code matches but whose provenance does not', () => {
    expect(planRecode([unit(1, 0, 0, 'AMD-COLD-A-01')], opts()).writes).toHaveLength(1)
  })

  // ── refusals: any one voids the whole batch ──
  it('refuses the whole batch when a template yields duplicates', () => {
    const plan = planRecode(
      [unit(1, 0, 0, 'A'), unit(2, 1, 0, 'B')],
      opts({ template: '{wh}-{block}' }),
    )
    expect(plan.writes).toEqual([])
    expect(plan.refusals.some((r) => r.kind === 'duplicate')).toBe(true)
  })

  it('refuses a collision with a code outside the batch, naming the incumbent', () => {
    const plan = planRecode([unit(1, 0, 0, 'A')], opts({
      takenCodes: new Map([['amd-cold-a-01', 99]]),
    }))
    expect(plan.refusals[0].kind).toBe('collision')
    expect(plan.refusals[0].to).toBe('AMD-COLD-A-01')
    expect(plan.refusals[0].heldBy).toBe(99)
  })

  it('folds case when looking for a collision — an inactive legacy row still owns its code', () => {
    const plan = planRecode([unit(1, 0, 0, 'A')], opts({
      takenCodes: new Map([['AMD-COLD-A-01'.toLowerCase(), 99]]),
    }))
    expect(plan.refusals[0].kind).toBe('collision')
  })

  it('allows a straight swap inside the batch — the two-phase write handles it', () => {
    const plan = planRecode(
      [unit(1, 0, 0, 'AMD-COLD-A-02'), unit(2, 1, 0, 'AMD-COLD-A-01')],
      opts({ takenCodes: new Map([['amd-cold-a-02', 1], ['amd-cold-a-01', 2]]) }),
    )
    expect(plan.refusals).toEqual([])
    expect(plan.writes.map((w) => `${w.from}->${w.to}`))
      .toEqual(['AMD-COLD-A-02->AMD-COLD-A-01', 'AMD-COLD-A-01->AMD-COLD-A-02'])
  })

  it('refuses when a derived LEVEL code collides outside the batch', () => {
    const rack = unit(1, 0, 0, 'AMD-B-0-0', {
      levels: [{ id: 11, levelIndex: 1, code: 'AMD-B-0-0-L1' }],
    })
    const plan = planRecode([rack], opts({ takenCodes: new Map([['amd-cold-a-01-l1', 99]]) }))
    expect(plan.refusals.some((r) => r.kind === 'collision')).toBe(true)
  })

  it('refuses a rendered code that fails codeIssue, naming the offender', () => {
    const plan = planRecode([unit(1, 0, 0, 'A')], opts({ template: '{n:04}' }))
    expect(plan.writes).toEqual([])
    expect(plan.refusals[0].kind).toBe('numeric_only')
    expect(plan.refusals[0].to).toBe('0001')
  })

  it('refuses rather than truncating when the rendered code is too long', () => {
    const plan = planRecode([unit(1, 0, 0, 'A')], opts({ block: 'X'.repeat(24), template: `{wh}-{block}-${'Y'.repeat(24)}-{n}` }))
    expect(plan.refusals[0].kind).toBe('too_long')
  })

  it('measures the LEVEL code for length, not just the rack code', () => {
    // `-L3` is three characters the rack code does not carry.
    const rack = unit(1, 0, 0, 'A', { levels: [{ id: 11, levelIndex: 3, code: 'A-L3' }] })
    const block = 'X'.repeat(24)
    const plan = planRecode([rack], opts({ block, template: `{wh}-{block}-${'Y'.repeat(15)}-{n}` }))
    expect(plan.refusals.some((r) => r.kind === 'too_long' && r.to.endsWith('-L3'))).toBe(true)
  })

  it('refuses a non-storage kind that the marquee let through', () => {
    const zone = unit(1, 0, 0, 'AMD-Z1', { kind: 'ZONE' })
    expect(planRecode([zone], opts()).refusals[0].kind).toBe('kind')
  })

  // ── warnings: reported, never fatal ──
  it('reports the ids whose sticker is already on the racking, without refusing', () => {
    const plan = planRecode(
      [unit(1, 0, 0, 'A', { labelPrinted: true }), unit(2, 1, 0, 'B')],
      opts(),
    )
    expect(plan.refusals).toEqual([])
    expect(plan.labelPrinted).toEqual([1])
    expect(plan.writes).toHaveLength(2)
  })

  it('counts units holding stock without refusing them', () => {
    const plan = planRecode([unit(1, 0, 0, 'A', { hasStock: true })], opts())
    expect(plan.refusals).toEqual([])
    expect(plan.holdingStock).toEqual([1])
  })

  it('lists every resulting code so the caller can size the barcode', () => {
    const rack = unit(1, 0, 0, 'A', { levels: [{ id: 11, levelIndex: 1, code: 'A-L1' }] })
    expect(planRecode([rack], opts()).allCodes).toEqual(['AMD-COLD-A-01', 'AMD-COLD-A-01-L1'])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// SELECTION-RELATIVE COORDINATES
//
// `{x}`/`{y}` are where a bin sits on the GRID. That is the whole of the reported
// bug: an operator painted one bin, typed BULK, and got `AMADIYA-BULK-3-3` — the
// cell's map position — where they meant "the first bin of this block".
// `{row}`/`{col}` count WITHIN THE PAINTED SELECTION instead, so the first bin of
// every block is 1-1 no matter where on the floor it stands.
// ══════════════════════════════════════════════════════════════════════════════

describe('buildSelectionFrame', () => {
  const cells = (...pairs: Array<[number, number]>) => pairs.map(([x, y]) => ({ floor: 0, x, y }))
  const at = (frame: SelectionFrame, x: number, y: number) => frame.index.get(frameKey({ floor: 0, x, y }))

  it('ranks occupied rows and columns from 1 at the north-west corner', () => {
    // A 3-wide, 2-deep block sitting at an arbitrary grid offset.
    const frame = buildSelectionFrame(cells([5, 7], [6, 7], [7, 7], [5, 8], [6, 8], [7, 8]), 'nw')
    expect(frame.rows).toBe(2)
    expect(frame.cols).toBe(3)
    expect(at(frame, 5, 7)).toEqual({ row: 1, col: 1 })
    expect(at(frame, 7, 7)).toEqual({ row: 1, col: 3 })
    expect(at(frame, 5, 8)).toEqual({ row: 2, col: 1 })
  })

  // DENSE. Two rack runs with a walkway between them are rows 1 and 2, not 1 and 3.
  it('skips a wholly empty grid row — it consumes no number', () => {
    const frame = buildSelectionFrame(cells([0, 0], [1, 0], [0, 5], [1, 5]), 'nw')
    expect(frame.rows).toBe(2)
    expect(at(frame, 0, 5)).toEqual({ row: 2, col: 1 })
  })

  // Dense on BOTH axes, which is the operator's call: a hole in a rack run must not
  // burn a column number either, or the codes stop matching how the run is counted.
  it('compresses a missing bin inside an occupied row', () => {
    const frame = buildSelectionFrame(cells([0, 0], [1, 0], [3, 0]), 'nw')
    expect(frame.cols).toBe(3)
    expect(at(frame, 3, 0)).toEqual({ row: 1, col: 3 })
  })

  it('reverses the row ranks under a southern origin', () => {
    const frame = buildSelectionFrame(cells([0, 0], [0, 1], [0, 2]), 'sw')
    expect(at(frame, 0, 2)).toEqual({ row: 1, col: 1 })
    expect(at(frame, 0, 0)).toEqual({ row: 3, col: 1 })
  })

  it('reverses the column ranks under an eastern origin', () => {
    const frame = buildSelectionFrame(cells([0, 0], [1, 0], [2, 0]), 'ne')
    expect(at(frame, 2, 0)).toEqual({ row: 1, col: 1 })
    expect(at(frame, 0, 0)).toEqual({ row: 1, col: 3 })
  })

  it('ranks each floor independently — a walk cannot cross one', () => {
    const frame = buildSelectionFrame(
      [{ floor: 0, x: 0, y: 0 }, { floor: 1, x: 9, y: 9 }],
      'nw',
    )
    expect(frame.index.get(frameKey({ floor: 1, x: 9, y: 9 }))).toEqual({ row: 1, col: 1 })
  })

  it('is empty for an empty selection rather than throwing', () => {
    const frame = buildSelectionFrame([], 'nw')
    expect(frame.rows).toBe(0)
    expect(frame.cols).toBe(0)
  })
})

describe('formatCode with {row}/{col}', () => {
  it('renders the frame origin as 1-1 — the reported bug', () => {
    expect(formatCode('{wh}-{block}-{row}-{col}', bind({ block: 'BULK', row: 1, col: 1 })))
      .toBe('AMD-BULK-1-1')
  })

  it('pads {row} and {col}', () => {
    expect(formatCode('{block}-{row:02}{col:02}', bind({ block: 'A', row: 3, col: 12 })))
      .toBe('A-0312')
  })

  // Back-compat of the old call shape: every existing caller binds neither.
  it('drops an unbound {row} and collapses its separator', () => {
    expect(formatCode('{wh}-{block}-{row}-{col}', bind({ block: 'BULK' }))).toBe('AMD-BULK')
  })

  it('accepts both in templateIssue', () => {
    expect(templateIssue('{wh}-{block}-{row}-{col}')).toBeNull()
    expect(templateIssue('{wh}-{row:02}')).toBeNull()
  })
})

describe('orderCells with an origin', () => {
  const grid = [
    { floor: 0, x: 0, y: 0, id: 'a' }, { floor: 0, x: 1, y: 0, id: 'b' },
    { floor: 0, x: 0, y: 1, id: 'c' }, { floor: 0, x: 1, y: 1, id: 'd' },
  ]

  it('with no origin argument is byte-identical to today', () => {
    expect(orderCells(grid, 'row').map((c) => c.id))
      .toEqual(orderCells(grid, 'row', 'nw').map((c) => c.id))
  })

  it('walks the block end-for-end from the south-east', () => {
    expect(orderCells(grid, 'row', 'se').map((c) => c.id)).toEqual(['d', 'c', 'b', 'a'])
  })

  // The parity trap, restated under a reversed origin: serpentine alternates by
  // position in the sorted line sequence, so the FIRST line always runs forwards.
  it('keeps serpentine parity keyed off sequence position under a reversed origin', () => {
    const three = [
      { floor: 0, x: 0, y: 7, id: 'a1' }, { floor: 0, x: 1, y: 7, id: 'a2' },
      { floor: 0, x: 0, y: 8, id: 'b1' }, { floor: 0, x: 1, y: 8, id: 'b2' },
    ]
    // From the south-west, row y=8 is the first line and must run forwards (x asc).
    expect(orderCells(three, 'serpentine-row', 'sw').map((c) => c.id))
      .toEqual(['b1', 'b2', 'a2', 'a1'])
  })
})

describe('usedTokens / styleOfTemplate / templateForStyle', () => {
  // This pins that the silent no-op was real: the built-in pattern carries neither a
  // counter nor a selection coordinate, so `Start at` and `Order` could not affect it.
  it('proves BUILTIN_PATTERN uses neither {n} nor {row}', () => {
    const used = usedTokens(BUILTIN_PATTERN.template)
    expect(used.has('n')).toBe(false)
    expect(used.has('row')).toBe(false)
    expect(used.has('x')).toBe(true)
  })

  it('reports every token a template actually uses', () => {
    expect([...usedTokens('{wh}-{block}-{n:03}')].sort()).toEqual(['block', 'n', 'wh'])
  })

  it('classifies the three numbering styles', () => {
    expect(styleOfTemplate('{wh}-{block}-{row}-{col}')).toBe('row-col')
    expect(styleOfTemplate('{wh}-{block}-{n:02}')).toBe('sequence')
    expect(styleOfTemplate(BUILTIN_PATTERN.template)).toBe('custom')
  })

  it('round-trips every style through templateForStyle', () => {
    for (const style of ['row-col', 'sequence'] as const) {
      expect(styleOfTemplate(templateForStyle(style, { pad: 2, colFirst: false }))).toBe(style)
    }
  })

  it('honours colFirst by swapping which coordinate leads', () => {
    expect(templateForStyle('row-col', { pad: 0, colFirst: true })).toContain('{col}-{row}')
  })

  it('arms {row}/{col} in the wizard default, and leaves the built-in alone', () => {
    expect(styleOfTemplate(WIZARD_DEFAULT_PATTERN.template)).toBe('row-col')
    expect(BUILTIN_PATTERN.template).toBe('{wh}-{block}-{x}-{y}')
  })

  /**
   * The two patterns exist for DIFFERENT jobs, and a sweep must never fall back to
   * the wrong one.
   *
   * Found in a browser on dev: the client planned `AMADIYA-BULK-1-1` and the server
   * returned `AMADIYA-BULK-3-3`, because the client fell back to the wizard default
   * while `recode_locations` fell back to BUILTIN — whose `{x}`/`{y}` are absolute
   * grid coordinates. That is the originally reported bug arriving through a second
   * door, and neither the engine tests nor the wire-body tests could see it, because
   * each half was correct in isolation and only the FALLBACK CHAINS disagreed.
   *
   * BUILTIN keeps draw-time minting byte-identical to the historical code. A sweep's
   * default is the wizard's. Anything that resolves a sweep's template must land on
   * a selection-relative pattern.
   */
  it('keeps a sweep default selection-relative and a draw-time default grid-absolute', () => {
    expect(usedTokens(WIZARD_DEFAULT_PATTERN.template).has('x')).toBe(false)
    expect(usedTokens(WIZARD_DEFAULT_PATTERN.template).has('row')).toBe(true)
    expect(usedTokens(BUILTIN_PATTERN.template).has('x')).toBe(true)
    expect(WIZARD_DEFAULT_PATTERN.template).not.toBe(BUILTIN_PATTERN.template)
  })
})

describe('planRecode — selection-relative numbering', () => {
  const rowCol = (over = {}) => opts({ template: '{wh}-{block}-{row}-{col}', block: 'BULK', ...over })

  // THE OPERATOR'S SCENARIO, end to end.
  it('numbers a painted block 1-1 regardless of where it sits on the grid', () => {
    const plan = planRecode(
      [unit(1, 3, 3, 'AMADIYA-B-3-3'), unit(2, 4, 3, 'AMADIYA-B-4-3'), unit(3, 3, 4, 'AMADIYA-B-3-4')],
      rowCol({ wh: 'AMADIYA' }),
    )
    expect(plan.refusals).toEqual([])
    expect(plan.writes.map((w) => w.to))
      .toEqual(['AMADIYA-BULK-1-1', 'AMADIYA-BULK-1-2', 'AMADIYA-BULK-2-1'])
  })

  it('restarts at 1-1 for a second block painted elsewhere', () => {
    const plan = planRecode([unit(9, 40, 40, 'X')], rowCol({ block: 'COLD' }))
    expect(plan.writes[0].to).toBe('AMD-COLD-1-1')
  })

  // The walk and the coordinates share an origin, so the first bin VISITED is also
  // the bin numbered 1-1. Asserted as a mapping, since the array order is the walk.
  it('re-frames under a different origin, and the walk starts at that corner', () => {
    const units = [unit(1, 0, 0, 'A'), unit(2, 1, 0, 'B')]
    const plan = planRecode(units, rowCol({ origin: 'ne' }))
    expect(Object.fromEntries(plan.writes.map((w) => [w.id, w.to])))
      .toEqual({ 2: 'AMD-BULK-1-1', 1: 'AMD-BULK-1-2' })
    expect(plan.writes[0].id).toBe(2)
  })

  // Idempotence, restated for the new scheme — the property the whole design rests on.
  it('is a no-op when re-run over the identical selection', () => {
    const first = planRecode([unit(1, 3, 3, 'X'), unit(2, 4, 3, 'Y')], rowCol())
    const settled = first.writes.map((w, i) =>
      unit(w.id, i === 0 ? 3 : 4, 3, w.to, { codeBlock: w.codeBlock, codeSeq: w.seq }))
    const second = planRecode(settled, rowCol())
    expect(second.writes).toEqual([])
    expect(second.unchanged).toBe(2)
  })

  // The division of labour: coordinates leave gaps, the counter does not.
  it('leaves {n} contiguous across a gap the coordinates preserve', () => {
    const units = [unit(1, 0, 0, 'A'), unit(2, 1, 0, 'B'), unit(3, 3, 0, 'C')]
    expect(planRecode(units, opts({ template: '{block}-{n:02}', block: 'BULK' })).writes.map((w) => w.to))
      .toEqual(['BULK-01', 'BULK-02', 'BULK-03'])
    expect(planRecode(units, rowCol()).writes.map((w) => w.to))
      .toEqual(['AMD-BULK-1-1', 'AMD-BULK-1-2', 'AMD-BULK-1-3'])
  })
})

describe('planRecode — growing an existing block', () => {
  const rowCol = (over = {}) => opts({ template: '{wh}-{block}-{row}-{col}', block: 'BULK', ...over })
  // Two bins already swept, sitting at grid x=0 and x=1.
  const incumbents = [
    unit(1, 0, 0, 'AMD-BULK-1-1', { codeBlock: 'BULK', codeSeq: 1 }),
    unit(2, 1, 0, 'AMD-BULK-1-2', { codeBlock: 'BULK', codeSeq: 2 }),
  ]

  it('frames over the union and writes only the newly selected units', () => {
    const fresh = [unit(3, 2, 0, 'AMD-B-2-0')]
    const plan = planRecode(fresh, rowCol({
      incumbents,
      frameCells: [...incumbents, ...fresh],
      start: 3,
    }))
    expect(plan.refusals).toEqual([])
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0].to).toBe('AMD-BULK-1-3')
  })

  it('refuses the whole batch and names the drift when an incumbent would move', () => {
    // A new bin painted WEST of the block shifts every incumbent one column right.
    const fresh = [unit(3, -1, 0, 'AMD-B-X')]
    const plan = planRecode(fresh, rowCol({
      incumbents,
      frameCells: [...incumbents, ...fresh],
      start: 3,
    }))
    expect(plan.writes).toEqual([])
    expect(plan.refusals.some((r) => r.kind === 'drift')).toBe(true)
    expect(plan.drift.map((d) => d.id).sort()).toEqual([1, 2])
    expect(plan.drift[0].would).not.toBe(plan.drift[0].code)
  })

  it('writes everything under renumber-all semantics, and reports no drift', () => {
    const fresh = [unit(3, -1, 0, 'AMD-B-X')]
    const plan = planRecode([...incumbents, ...fresh], rowCol({ start: 1 }))
    expect(plan.refusals).toEqual([])
    expect(plan.drift).toEqual([])
    expect(plan.writes).toHaveLength(3)
  })

  it('never drifts under a pure-{n} template, because an incumbent keeps its code_seq', () => {
    const seqIncumbents = [
      unit(1, 0, 0, 'BULK-01', { codeBlock: 'BULK', codeSeq: 1 }),
      unit(2, 1, 0, 'BULK-02', { codeBlock: 'BULK', codeSeq: 2 }),
    ]
    const plan = planRecode([unit(3, -1, 0, 'Z')], opts({
      template: '{block}-{n:02}', block: 'BULK', start: 3,
      incumbents: seqIncumbents,
      frameCells: [...seqIncumbents, unit(3, -1, 0, 'Z')],
    }))
    expect(plan.drift).toEqual([])
    expect(plan.writes[0].to).toBe('BULK-03')
  })

  it('surfaces a template changed between sweeps as drift', () => {
    const plan = planRecode([unit(3, 2, 0, 'N')], rowCol({
      template: '{wh}-{block}-R{row}-C{col}',
      incumbents,
      frameCells: [...incumbents, unit(3, 2, 0, 'N')],
      start: 3,
    }))
    expect(plan.drift).toHaveLength(2)
  })
})

describe('solveBlockFraming', () => {
  const framingOpts = { template: '{wh}-{block}-{row}-{col}', block: 'BULK', wh: 'AMD' }

  it('recovers a block originally swept from the north-east', () => {
    // Numbered right-to-left: the eastern bin is column 1.
    const members = [
      unit(1, 0, 0, 'AMD-BULK-1-2', { codeBlock: 'BULK', codeSeq: 2 }),
      unit(2, 1, 0, 'AMD-BULK-1-1', { codeBlock: 'BULK', codeSeq: 1 }),
    ]
    expect(solveBlockFraming(members, framingOpts)?.origin).toBe('ne')
  })

  it('returns null when no framing reproduces the incumbents', () => {
    const members = [
      unit(1, 0, 0, 'HAND-TYPED-A', { codeBlock: 'BULK', codeSeq: 1 }),
      unit(2, 1, 0, 'HAND-TYPED-B', { codeBlock: 'BULK', codeSeq: 2 }),
    ]
    expect(solveBlockFraming(members, framingOpts)).toBeNull()
  })

  it('is deterministic when several framings fit', () => {
    // A single bin reproduces under all four corners; the answer must not wobble.
    const one = [unit(1, 0, 0, 'AMD-BULK-1-1', { codeBlock: 'BULK', codeSeq: 1 })]
    expect(solveBlockFraming(one, framingOpts)).toEqual(solveBlockFraming(one, framingOpts))
    expect(solveBlockFraming(one, framingOpts)?.origin).toBe('nw')
  })

  it('is null for an empty block rather than guessing', () => {
    expect(solveBlockFraming([], framingOpts)).toBeNull()
  })
})
