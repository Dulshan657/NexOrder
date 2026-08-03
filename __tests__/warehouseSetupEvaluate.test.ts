import { describe, it, expect } from 'vitest'
import { evaluateSetup, type SetupInput } from '../lib/warehouseSetup/evaluate'
import { SETUP_STEPS, SIGNOFF_STEP_KEYS, stepsFor } from '../lib/warehouseSetup/steps'

/** A brand-new racked site: nothing configured, nothing drawn, no stock. The
 *  three vocabularies are SEEDED, which is exactly why they are sign-offs. */
function freshRacked(over: Partial<SetupInput> = {}): SetupInput {
  return {
    warehouseId: 1,
    locationType: 'racked',
    acknowledgedKeys: [],
    storageFormCount: 6,
    levelRoleCount: 3,
    pickZoneRoleCount: 1,
    zoneProfileCount: 8,
    hasWarehouseRule: false,
    layout: { hasDraft: false, publishedLayoutId: null, needsRepublish: false },
    labels: null,
    productCount: 0,
    replenConfiguredCount: 0,
    hasBinLevelStock: false,
    hasAnyStock: false,
    ...over,
  }
}

/** Everything done, both derived and signed off. */
function liveRacked(over: Partial<SetupInput> = {}): SetupInput {
  return freshRacked({
    acknowledgedKeys: [...SIGNOFF_STEP_KEYS],
    hasWarehouseRule: true,
    layout: { hasDraft: false, publishedLayoutId: 42, needsRepublish: false },
    labels: { total: 189, outstanding: 0 },
    productCount: 320,
    replenConfiguredCount: 25,
    hasBinLevelStock: true,
    hasAnyStock: true,
    ...over,
  })
}

const byKey = (s: ReturnType<typeof evaluateSetup>, key: string) =>
  s.steps.find((x) => x.step.key === key)!

describe('evaluateSetup — step list shape', () => {
  it('gives a racked site the full chain and a bulk site only the shared steps', () => {
    expect(stepsFor('racked')).toHaveLength(SETUP_STEPS.length)

    const bulk = evaluateSetup(freshRacked({ locationType: 'bulk' }))
    expect(bulk.steps.map((s) => s.step.key)).toEqual([
      'catalogue_loaded',
      'opening_stock',
      'exercise_pick',
    ])
  })

  it('has no duplicate step keys and no dangling blockedBy reference', () => {
    const keys = SETUP_STEPS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const step of SETUP_STEPS) {
      for (const dep of step.blockedBy) expect(keys).toContain(dep)
    }
  })
})

describe('evaluateSetup — the dependency chain', () => {
  it('blocks everything downstream of an unpublished layout', () => {
    const s = evaluateSetup(freshRacked())

    // The storage-forms arrow: racks must not be drawn before forms are settled.
    expect(byKey(s, 'layout_published').status).toBe('blocked')
    expect(byKey(s, 'layout_published').blockedBy).toEqual([
      SETUP_STEPS[0].title,
    ])

    expect(byKey(s, 'labels_confirmed').status).toBe('blocked')
    expect(byKey(s, 'replen_min_max').status).toBe('blocked')
    expect(byKey(s, 'opening_stock').status).toBe('blocked')
    expect(byKey(s, 'exercise_putaway').status).toBe('blocked')
    expect(byKey(s, 'exercise_replen').status).toBe('blocked')
  })

  it('marks exactly one unfinished, unblocked step as current', () => {
    const s = evaluateSetup(freshRacked())
    expect(s.steps.filter((x) => x.status === 'current')).toHaveLength(1)
    expect(s.currentKey).toBe('storage_forms_reviewed')
  })

  it('moves current along as sign-offs land', () => {
    const s = evaluateSetup(
      freshRacked({ acknowledgedKeys: ['storage_forms_reviewed', 'level_roles_reviewed'] }),
    )
    expect(s.currentKey).toBe('zone_profiles_reviewed')
    // The layout is now unblocked but not yet the current step — rules come first.
    expect(byKey(s, 'layout_published').status).toBe('todo')
  })

  it('treats a prerequisite that does not apply to a bulk site as satisfied', () => {
    // opening_stock is blockedBy labels_confirmed, which is racked-only.
    const s = evaluateSetup(
      freshRacked({ locationType: 'bulk', productCount: 10 }),
    )
    expect(byKey(s, 'opening_stock').status).toBe('current')
    expect(byKey(s, 'opening_stock').blockedBy).toEqual([])
  })
})

describe('evaluateSetup — derived predicates', () => {
  it('does not count a published layout that has changed since publishing', () => {
    const input = liveRacked({
      layout: { hasDraft: false, publishedLayoutId: 42, needsRepublish: true },
    })
    const step = byKey(evaluateSetup(input), 'layout_published')
    expect(step.status).not.toBe('done')
    expect(step.evidence).toContain('republish')
  })

  it('needs every bin confirmed, not merely some', () => {
    const partial = byKey(
      evaluateSetup(liveRacked({ labels: { total: 189, outstanding: 3 } })),
      'labels_confirmed',
    )
    expect(partial.status).not.toBe('done')
    expect(partial.evidence).toBe('3 of 189 bins unconfirmed')
  })

  it('distinguishes stock received-but-unplaced from no stock at all', () => {
    const unplaced = byKey(
      evaluateSetup(liveRacked({ hasBinLevelStock: false, hasAnyStock: true })),
      'opening_stock',
    )
    expect(unplaced.status).not.toBe('done')
    expect(unplaced.evidence).toBe('received, none placed in bins')

    const none = byKey(
      evaluateSetup(liveRacked({ hasBinLevelStock: false, hasAnyStock: false })),
      'opening_stock',
    )
    expect(none.evidence).toBe('no stock counted yet')
  })

  it('accepts root-level stock on a bulk site, where the root is correct', () => {
    const s = evaluateSetup(
      freshRacked({
        locationType: 'bulk',
        productCount: 10,
        hasAnyStock: true,
        hasBinLevelStock: false,
      }),
    )
    expect(byKey(s, 'opening_stock').status).toBe('done')
  })

  it('ignores a global rule — the step is about this site being considered', () => {
    expect(byKey(evaluateSetup(freshRacked()), 'optimizer_rules').evidence)
      .toBe('using engine defaults')
    expect(byKey(evaluateSetup(freshRacked({ hasWarehouseRule: true })), 'optimizer_rules').status)
      .toBe('done')
  })
})

describe('evaluateSetup — summary', () => {
  it('reports a fully live site as complete', () => {
    const s = evaluateSetup(liveRacked())
    expect(s.doneCount).toBe(s.totalCount)
    expect(s.derivedComplete).toBe(true)
    expect(s.outstandingSignoffs).toBe(0)
    expect(s.currentKey).toBeNull()
  })

  it('separates derived completeness from outstanding sign-offs, so an already-live site can collapse', () => {
    const s = evaluateSetup(liveRacked({ acknowledgedKeys: [] }))
    expect(s.derivedComplete).toBe(true)
    expect(s.outstandingSignoffs).toBe(
      stepsFor('racked').filter((x) => x.kind === 'signoff').length,
    )
    expect(s.doneCount).toBeLessThan(s.totalCount)
  })

  it('counts a fresh racked site as zero of thirteen', () => {
    const s = evaluateSetup(freshRacked())
    expect(s.doneCount).toBe(0)
    expect(s.totalCount).toBe(13)
    expect(s.derivedComplete).toBe(false)
  })
})
