import { describe, it, expect } from 'vitest'
import {
  allocateAcrossTasks,
  decideDeskAction,
  decidePutawayCompletion,
  type CompletionInput,
} from '../supabase/functions/_shared/putawayCompletion'

const input = (o: Partial<CompletionInput> = {}): CompletionInput => ({
  task: { status: 'suggested', quantity: 100, suggestedLocationId: 20, assignedLocationId: null },
  actualLocationId: 20,
  role: 'Warehouse',
  existingHomeLocationId: 20,
  ...o,
})

describe('decidePutawayCompletion', () => {
  it('completes a suggested task without assign', () => {
    expect(decidePutawayCompletion(input())).toMatchObject({
      ok: true, status: 'accepted', placedQty: 100, remainderQty: 0, remainderStatus: null,
    })
    // An assigned task still completes against the bin the desk assigned.
    expect(decidePutawayCompletion(input({
      task: { status: 'assigned', quantity: 10, suggestedLocationId: 20, assignedLocationId: 31 },
      actualLocationId: 31,
    }))).toMatchObject({ ok: true, status: 'accepted' })
    // Anything already finished is a race the caller lost.
    expect(decidePutawayCompletion(input({
      task: { status: 'accepted', quantity: 10, suggestedLocationId: 20, assignedLocationId: null },
    }))).toMatchObject({ ok: false, code: 'CONFLICT' })
  })

  it('requires a reason for a different bin', () => {
    expect(decidePutawayCompletion(input({ actualLocationId: 44 })))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(decidePutawayCompletion(input({ actualLocationId: 44, overrideReason: 'whatever' })))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(decidePutawayCompletion(input({ actualLocationId: 44, overrideReason: 'blocked' })))
      .toMatchObject({ ok: true, status: 'overridden', overrideReason: 'blocked' })
    // The pre-NX-0006 walk (an ASSIGNED task) never sent a reason; it keeps working.
    expect(decidePutawayCompletion(input({
      task: { status: 'assigned', quantity: 10, suggestedLocationId: 20, assignedLocationId: 31 },
      actualLocationId: 44,
    }))).toMatchObject({ ok: true, status: 'overridden', overrideReason: null })
  })

  it('marks the remainder short when flagged', () => {
    expect(decidePutawayCompletion(input({ quantity: 98, short: true }))).toMatchObject({
      ok: true, placedQty: 98, remainderQty: 2, remainderStatus: 'short',
    })
    // Without the flag the remainder stays open on the dock, as before.
    expect(decidePutawayCompletion(input({ quantity: 98 }))).toMatchObject({
      ok: true, remainderQty: 2, remainderStatus: 'open',
    })
    expect(decidePutawayCompletion(input({ quantity: 101 })))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(decidePutawayCompletion(input({ quantity: 0 })))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  })

  it('make_home only when the product has no home', () => {
    expect(decidePutawayCompletion(input({ makeHome: true, existingHomeLocationId: null })))
      .toMatchObject({ ok: true, setHome: true })
    expect(decidePutawayCompletion(input({ makeHome: true, existingHomeLocationId: 20 })))
      .toMatchObject({ ok: false, code: 'FORBIDDEN' })
    const manager = decidePutawayCompletion(input({ makeHome: true, existingHomeLocationId: 20, role: 'Manager' }))
    expect(manager).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(manager.ok === false && manager.message).toMatch(/home bin/i)
    expect(decidePutawayCompletion(input())).toMatchObject({ ok: true, setHome: false })
  })
})

describe('allocateAcrossTasks', () => {
  const t = (id: number, quantity: number, createdAt: string, o: Partial<{ productId: number; huId: number | null }> = {}) =>
    ({ id, productId: 1, huId: null, quantity, createdAt, ...o })

  it('fills oldest first and refuses mixed products or plates', () => {
    expect(allocateAcrossTasks([t(2, 10, '2026-10-27T10:00Z'), t(1, 30, '2026-10-26T09:00Z')], 35)).toEqual({
      ok: true, allocations: [{ id: 1, quantity: 30 }, { id: 2, quantity: 5 }],
    })
    expect(allocateAcrossTasks([t(1, 10, 'a'), t(2, 10, 'b', { productId: 2 })], 5))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(allocateAcrossTasks([t(1, 10, 'a'), t(2, 10, 'b', { huId: 7 })], 5))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(allocateAcrossTasks([t(1, 10, 'a'), t(2, 10, 'b')], 21))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  })
})

describe('decideDeskAction', () => {
  it('redirect and resolve_short are Admin/Manager only; write_off needs a reason', () => {
    expect(decideDeskAction({ action: 'redirect', role: 'Manager', taskStatus: 'suggested' })).toEqual({ ok: true })
    expect(decideDeskAction({ action: 'redirect', role: 'Warehouse', taskStatus: 'suggested' }))
      .toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(decideDeskAction({ action: 'redirect', role: 'Admin', taskStatus: 'assigned' }))
      .toMatchObject({ ok: false, code: 'CONFLICT' })
    expect(decideDeskAction({ action: 'resolve_short', role: 'Admin', taskStatus: 'short', resolution: 'found' }))
      .toEqual({ ok: true })
    expect(decideDeskAction({ action: 'resolve_short', role: 'Admin', taskStatus: 'short', resolution: 'write_off', reason: '  ' }))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(decideDeskAction({ action: 'resolve_short', role: 'Manager', taskStatus: 'short', resolution: 'write_off', reason: 'not on the truck' }))
      .toEqual({ ok: true })
    expect(decideDeskAction({ action: 'resolve_short', role: 'Admin', taskStatus: 'suggested', resolution: 'found' }))
      .toMatchObject({ ok: false, code: 'CONFLICT' })
  })
})
