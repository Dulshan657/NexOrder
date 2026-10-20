// toSalesTarget turns a sales_targets row into the frontend's SalesTarget.
//
// The row's user_id is a profile UUID. The frontend identifies people by a numeric
// hash of that UUID (lib/profileToUser.ts numericIdForProfile), and every consumer
// compares SalesTarget.userId with currentUser.id. The adapter used to do
// `Number(row.user_id) || 0`, which is NaN-then-0 for any UUID, so no target ever
// belonged to anyone.

import { describe, it, expect } from 'vitest'
import { toSalesTarget } from '../lib/adapters'
import { numericIdForProfile, profileToUser } from '../lib/profileToUser'
import type { Database } from '../lib/database.types'
import { runVoiceTool } from '../lib/voice/runVoiceTool'
import { MANAGER, REP_A, ctxFor } from './voice/voiceFixtures'

type TargetRow = Database['public']['Tables']['sales_targets']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']

const REP_UUID = '3f2a1b2c-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const OTHER_UUID = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

function row(over: Partial<TargetRow> = {}): TargetRow {
  return {
    id: 'TGT-1',
    user_id: REP_UUID,
    type: 'revenue',
    target_value: 12000.5,
    start_date: '2026-10-01',
    end_date: '2026-10-31',
    created_at: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

function profile(id: string): ProfileRow {
  return {
    id,
    name: 'Alice Rep',
    email: 'alice@example.test',
    role: 'Field Sales Rep',
    avatar_url: null,
    horeca_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    home_warehouse_id: null,
  }
}

describe('toSalesTarget', () => {
  it('maps the owner uuid to the numeric id the app derives for that profile', () => {
    expect(toSalesTarget(row()).userId).toBe(numericIdForProfile(REP_UUID))
  })

  it('gives exactly the id profileToUser gives the same profile, so currentUser.id matches', () => {
    expect(toSalesTarget(row()).userId).toBe(profileToUser(profile(REP_UUID)).id)
  })

  it('no longer collapses every real uuid to 0', () => {
    const id = toSalesTarget(row()).userId
    expect(id).not.toBe(0)
    expect(Number.isInteger(id)).toBe(true)
    expect(toSalesTarget(row({ user_id: OTHER_UUID })).userId).toBe(numericIdForProfile(OTHER_UUID))
  })

  it('gives 0 when there is no owner', () => {
    expect(toSalesTarget(row({ user_id: null as unknown as string })).userId).toBe(0)
    expect(toSalesTarget(row({ user_id: undefined as unknown as string })).userId).toBe(0)
    expect(toSalesTarget(row({ user_id: '' })).userId).toBe(0)
  })

  it('maps the rest of the row as before', () => {
    expect(toSalesTarget(row({ target_value: '12000.50' as unknown as number }))).toMatchObject({
      id: 'TGT-1',
      type: 'revenue',
      targetValue: 12000.5,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      createdAt: '2026-10-01T00:00:00.000Z',
    })
  })

  it('is what lets get_target_progress find the rep who owns a target', () => {
    // The voice tool compares SalesTarget.userId with ctx.user.numericId, which the
    // launcher takes from currentUser.id (profileToUser). Built from a row, it must match.
    const rep = { ...REP_A, id: profileToUser(profile(REP_UUID)).id }
    const salesTargets = [
      toSalesTarget(row({ target_value: 1000 })),
      toSalesTarget(row({ id: 'TGT-2', user_id: OTHER_UUID })),
    ]

    const own = runVoiceTool('get_target_progress', {}, ctxFor(rep, { salesTargets }))
    expect(own.ok === true && (own.data as { targets: unknown[] }).targets).toHaveLength(1)

    // Two owners are two groups for a manager; with every owner read as 0 they were one.
    const all = runVoiceTool('get_target_progress', {}, ctxFor(MANAGER, { salesTargets }))
    expect(all.ok === true && (all.data as { repCount: number }).repCount).toBe(2)
  })
})
