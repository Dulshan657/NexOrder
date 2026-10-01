import { describe, it, expect } from 'vitest'

import { fromVisit, visitUpdateFields } from '../lib/adapters'
import type { Visit } from '../types'

const base: Visit = {
  id: 'VISIT-abc',
  hoReCaId: 7,
  userId: 1,
  scheduledVisitId: 'SV-1',
  arrivalTime: '2026-10-01T09:00:00.000Z',
  departureTime: '2026-10-01T09:30:00.000Z',
  outcome: 'order_placed',
  notes: 'ok',
  photos: ['a.jpg'],
  createdAt: '2026-10-01T09:30:00.000Z',
}

describe('fromVisit', () => {
  it('includes the client id, because visits.id has no database default', () => {
    expect(fromVisit(base).id).toBe('VISIT-abc')
  })

  it('maps optional fields to null and never sends created_at', () => {
    const row = fromVisit({ ...base, notes: undefined, scheduledVisitId: undefined })
    expect(row.notes).toBeNull()
    expect(row.scheduled_visit_id).toBeNull()
    expect(row).not.toHaveProperty('created_at')
  })
})

describe('visitUpdateFields', () => {
  it('returns null when nothing changed', () => {
    expect(visitUpdateFields(base, { ...base })).toBeNull()
  })

  it('returns only the changed editable columns', () => {
    const fields = visitUpdateFields(base, { ...base, notes: 'changed', outcome: 'no_interest' })
    expect(fields).toEqual({ notes: 'changed', outcome: 'no_interest' })
  })

  it('never sends identity or ownership columns', () => {
    const fields = visitUpdateFields(base, { ...base, id: 'other', userId: 2, hoReCaId: 9, notes: 'x' })
    expect(fields).toEqual({ notes: 'x' })
  })

  it('detects photo list changes', () => {
    expect(visitUpdateFields(base, { ...base, photos: ['a.jpg', 'b.jpg'] })).toEqual({
      photos: ['a.jpg', 'b.jpg'],
    })
  })
})
