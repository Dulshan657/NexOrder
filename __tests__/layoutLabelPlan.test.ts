import { describe, it, expect } from 'vitest'
import {
  SHEET_GROUPS,
  groupForKind,
  labelContext,
  MAX_CONTEXT_CHARS,
  planLabelJob,
  type LabelTargetRow,
} from '@/supabase/functions/_shared/labels/layoutLabelPlan'

/** A target row with sensible defaults; override only what the case is about. */
function row(over: Partial<LabelTargetRow> = {}): LabelTargetRow {
  return {
    locationId: 1,
    code: 'A3-04',
    kind: 'BIN',
    name: 'Bay 4',
    zoneName: null,
    aisleCode: null,
    levelRoleName: null,
    levelIndex: null,
    labelPrinted: false,
    ...over,
  }
}

describe('groupForKind', () => {
  it('sends storable slots to the small sticker sheet', () => {
    expect(groupForKind('BIN')).toBe('slots')
    expect(groupForKind('SHELF')).toBe('slots')
    expect(groupForKind('BAY')).toBe('slots')
  })

  it('sends wayfinding levels to the big sign sheet', () => {
    expect(groupForKind('ZONE')).toBe('wayfinding')
    expect(groupForKind('AISLE')).toBe('wayfinding')
    expect(groupForKind('RACK')).toBe('wayfinding')
  })

  it('sends staging to its own sheet', () => {
    expect(groupForKind('STAGING')).toBe('staging')
  })

  // A levelled rack is kind RACK and carries no placement row (mig 00072
  // deletes it); its SHELF levels are the storable slots. So the container
  // never lands in `slots` on kind alone, and there is nothing to special-case.
  it('never puts a container or a warehouse root in a slot sheet', () => {
    expect(groupForKind('RACK')).not.toBe('slots')
    expect(groupForKind('WAREHOUSE')).toBeNull()
    expect(groupForKind('nonsense')).toBeNull()
  })

  it('is case-insensitive about the kind it is handed', () => {
    expect(groupForKind('bin')).toBe('slots')
  })
})

describe('SHEET_GROUPS', () => {
  it('pairs each group with the stock it prints on', () => {
    const byGroup = Object.fromEntries(SHEET_GROUPS.map((g) => [g.group, g.preset]))
    expect(byGroup).toEqual({ wayfinding: 'a4-8', slots: 'a4-24', staging: 'a4-14' })
  })
})

describe('labelContext', () => {
  // Since mig 00094 a slot leads with its own NAME: that is the string the
  // operator reads on the pick list, and a sticker that does not repeat it makes
  // them translate between two vocabularies while holding a carton. The level
  // role follows, being the next question once you are at the right rack.
  it('leads a slot label with its own name, then the level role', () => {
    const context = labelContext(
      row({ kind: 'SHELF', code: 'A3-04-L1', name: 'Chiller · Rack 7 · L1', levelRoleName: 'Pick Zone', aisleCode: 'A3', zoneName: 'Chilled' }),
    )
    expect(context).toBe('Chiller · Rack 7 · L1 · Pick Zone')
  })

  it('omits a pre-00094 generated name, which only repeats the coordinate', () => {
    // `Bin 9,4` and `Level 4` say nothing the code above them does not.
    expect(
      labelContext(row({ kind: 'SHELF', code: 'A3-04-L1', name: 'Level 1', levelRoleName: 'Pick Zone', aisleCode: 'A3', zoneName: 'Chilled' })),
    ).toBe('Pick Zone · A3 · Chilled')
    expect(
      labelContext(row({ kind: 'BIN', code: 'NEXG-B-9-4', name: 'Bin 9,4', levelRoleName: 'Pick Zone' })),
    ).toBe('Pick Zone')
  })

  it('drops whole parts from the END rather than letting the sticker ellipsize', () => {
    // labelArtwork shrinks to 5pt and then truncates mid-word, silently. A long
    // area name would eat the level role that way; dropping zone-then-aisle
    // keeps the part an operator at the rack actually needs.
    const context = labelContext(
      row({
        kind: 'SHELF', code: 'A3-04-L1',
        name: 'Cold Room North · Rack 12 · L4',
        levelRoleName: 'Pick Zone', aisleCode: 'A3', zoneName: 'Chilled',
      }),
    )
    expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS)
    expect(context).toBe('Cold Room North · Rack 12 · L4')
  })

  it('never drops below one part, however long that part is', () => {
    const context = labelContext(
      row({ kind: 'SHELF', code: 'A3-04-L1', name: 'x'.repeat(80), levelRoleName: 'Pick Zone' }),
    )
    expect(context).toBe('x'.repeat(80))
  })

  it('leads a wayfinding label with the hierarchy instead', () => {
    expect(labelContext(row({ kind: 'AISLE', code: 'A3', zoneName: 'Chilled' }))).toBe('Chilled')
    expect(labelContext(row({ kind: 'RACK', code: 'A3-04', zoneName: 'Chilled', aisleCode: 'A3' }))).toBe(
      'Chilled · A3',
    )
  })

  it('never repeats the location it is describing', () => {
    // A zone's own name is its zoneName — printing 'Chilled · Chilled' would be absurd.
    expect(labelContext(row({ kind: 'ZONE', code: 'CHILL', name: 'Chilled', zoneName: 'Chilled' }))).toBe(
      'Chilled',
    )
    expect(labelContext(row({ kind: 'AISLE', code: 'A3', name: 'Aisle 3', aisleCode: 'A3' }))).toBe('Aisle 3')
  })

  it('falls back to the location name when it has no context at all', () => {
    expect(labelContext(row({ kind: 'STAGING', code: 'DOCK-1', name: 'Inbound dock' }))).toBe('Inbound dock')
  })

  it('still produces a usable line for a legacy level with no role or name', () => {
    const context = labelContext(row({ kind: 'SHELF', code: 'B1-02-L3', name: 'Level 3', levelRoleName: null, aisleCode: 'B1' }))
    expect(context).toBe('B1')
    expect(context).not.toContain('null')
  })

  it('never returns a bare separator or trailing punctuation', () => {
    for (const kind of ['ZONE', 'AISLE', 'RACK', 'BAY', 'SHELF', 'BIN', 'STAGING']) {
      const context = labelContext(row({ kind, name: null }))
      expect(context).not.toMatch(/^\s*·|·\s*$/)
    }
  })
})

describe('planLabelJob', () => {
  const rows: LabelTargetRow[] = [
    row({ locationId: 10, code: 'A3-04-L1', kind: 'SHELF', levelRoleName: 'Pick Zone', aisleCode: 'A3' }),
    row({ locationId: 11, code: 'A3-04-L2', kind: 'SHELF', levelRoleName: 'Reserve', aisleCode: 'A3' }),
    row({ locationId: 20, code: 'A3', kind: 'AISLE', zoneName: 'Chilled' }),
    row({ locationId: 21, code: 'CHILL', kind: 'ZONE', name: 'Chilled' }),
    row({ locationId: 30, code: 'DOCK-1', kind: 'STAGING', name: 'Inbound dock' }),
  ]

  it('splits a job into one sheet per stock, signs first', () => {
    const sheets = planLabelJob(rows)
    expect(sheets.map((s) => s.group)).toEqual(['wayfinding', 'slots', 'staging'])
    expect(sheets.map((s) => s.preset)).toEqual(['a4-8', 'a4-24', 'a4-14'])
    expect(sheets.map((s) => s.items.length)).toEqual([2, 2, 1])
  })

  it('drops empty groups rather than emitting a blank PDF', () => {
    const sheets = planLabelJob([row({ locationId: 1, code: 'B1', kind: 'AISLE' })])
    expect(sheets).toHaveLength(1)
    expect(sheets[0].group).toBe('wayfinding')
  })

  it('returns nothing when there is nothing to print', () => {
    expect(planLabelJob([])).toEqual([])
    expect(planLabelJob([row({ kind: 'WAREHOUSE' })])).toEqual([])
  })

  it('carries the code and the composed context through to each item', () => {
    const [wayfinding] = planLabelJob(rows)
    expect(wayfinding.items[0]).toMatchObject({ code: 'A3', context: 'Chilled', locationId: 20 })
  })

  it('preserves the order it was handed, which is the SQL ordering by code', () => {
    const slots = planLabelJob(rows).find((s) => s.group === 'slots')
    expect(slots?.items.map((i) => i.code)).toEqual(['A3-04-L1', 'A3-04-L2'])
  })

  it('deduplicates a location that arrives twice', () => {
    // An ancestor walk can surface the same zone once per descendant branch.
    const dupes = [
      row({ locationId: 21, code: 'CHILL', kind: 'ZONE', name: 'Chilled' }),
      row({ locationId: 21, code: 'CHILL', kind: 'ZONE', name: 'Chilled' }),
    ]
    expect(planLabelJob(dupes)[0].items).toHaveLength(1)
  })
})
