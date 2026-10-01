import { describe, it, expect } from 'vitest'

import { planPollBatch } from '../supabase/functions/_shared/poInbox/batchPlan'

const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }))

describe('planPollBatch', () => {
  it('processes everything and advances the watermark when under the cap', () => {
    const plan = planPollBatch(refs(10), new Set(), 25)
    expect(plan.toProcess).toHaveLength(10)
    expect(plan.advanceWatermark).toBe(true)
  })

  it('advances the watermark when exactly at the cap', () => {
    const plan = planPollBatch(refs(25), new Set(), 25)
    expect(plan.toProcess).toHaveLength(25)
    expect(plan.advanceWatermark).toBe(true)
  })

  it('holds the watermark when the backlog exceeds the cap', () => {
    const plan = planPollBatch(refs(30), new Set(), 25)
    expect(plan.toProcess.map((r) => r.id)).toEqual(refs(25).map((r) => r.id))
    expect(plan.advanceWatermark).toBe(false)
  })

  it('skips already-stored messages so a held watermark makes progress', () => {
    const stored = new Set(refs(25).map((r) => r.id))
    const plan = planPollBatch(refs(30), stored, 25)
    expect(plan.toProcess.map((r) => r.id)).toEqual(['m25', 'm26', 'm27', 'm28', 'm29'])
    expect(plan.advanceWatermark).toBe(true)
  })

  it('drains a 30-message backlog across two ticks', () => {
    const all = refs(30)
    const stored = new Set<string>()
    const first = planPollBatch(all, stored, 25)
    first.toProcess.forEach((r) => stored.add(r.id))
    const second = planPollBatch(all, stored, 25)
    second.toProcess.forEach((r) => stored.add(r.id))
    expect(stored.size).toBe(30)
    expect(first.advanceWatermark).toBe(false)
    expect(second.advanceWatermark).toBe(true)
  })

  it('does not mutate its inputs', () => {
    const input = refs(30)
    const snapshot = JSON.stringify(input)
    planPollBatch(input, new Set(['m0']), 25)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
