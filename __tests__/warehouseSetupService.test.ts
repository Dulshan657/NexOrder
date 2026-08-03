import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase client singleton before importing the service.
const { invoke, from } = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke }, from } }))

import {
  acknowledgeSetupStep,
  countReplenConfigured,
  getSetupAcks,
  revokeSetupStep,
} from '../services/supabase/warehouseSetupService'

/** Mirrors supabase-js FunctionsHttpError: a generic message plus the raw
 *  Response on `.context`. The real body is what the operator needs to see. */
function httpError(status: number, body: unknown): Error {
  const err = new Error('Edge Function returned a non-2xx status code')
  ;(err as Error & { context: Response }).context = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return err
}

describe('acknowledgeSetupStep', () => {
  beforeEach(() => invoke.mockReset())

  it('sends the action, warehouse and step, and adapts the row back', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        acknowledgement: {
          id: 7,
          warehouse_id: 3,
          step_key: 'wifi_walked',
          note: 'Weak at the back of aisle 4',
          acknowledged_by: 'uuid-1',
          acknowledged_at: '2026-08-03T00:00:00Z',
        },
      },
      error: null,
    })

    await expect(
      acknowledgeSetupStep({ warehouseId: 3, stepKey: 'wifi_walked', note: 'Weak at the back of aisle 4' }),
    ).resolves.toEqual({
      id: 7,
      warehouseId: 3,
      stepKey: 'wifi_walked',
      note: 'Weak at the back of aisle 4',
      acknowledgedBy: 'uuid-1',
      acknowledgedAt: '2026-08-03T00:00:00Z',
    })

    expect(invoke).toHaveBeenCalledWith('mutate-warehouse-setup-ack', {
      body: {
        action: 'acknowledge',
        warehouse_id: 3,
        step_key: 'wifi_walked',
        note: 'Weak at the back of aisle 4',
      },
    })
  })

  it('sends null, not undefined, for an omitted note', async () => {
    // The column is nullable and the server schema uses .nullish() for exactly
    // this: .optional() would accept undefined and REJECT the null we send.
    invoke.mockResolvedValue({ data: { ok: true, acknowledgement: { id: 1 } }, error: null })
    await acknowledgeSetupStep({ warehouseId: 3, stepKey: 'wifi_walked' })
    expect(invoke.mock.calls[0][1].body.note).toBeNull()
  })

  it('surfaces the server message rather than the generic invoke error', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(400, {
        error: {
          code: 'INVALID_INPUT',
          message: '"layout_published" is not a step that can be signed off.',
        },
      }),
    })
    await expect(
      acknowledgeSetupStep({ warehouseId: 3, stepKey: 'layout_published' }),
    ).rejects.toThrow('is not a step that can be signed off')
  })

  it('appends the offending field paths on a validation failure', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(400, {
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid request body',
          details: { issues: [{ path: 'note', message: 'String must contain at most 400 character(s)' }] },
        },
      }),
    })
    await expect(
      acknowledgeSetupStep({ warehouseId: 3, stepKey: 'wifi_walked', note: 'x' }),
    ).rejects.toThrow(/note/)
  })
})

describe('revokeSetupStep', () => {
  beforeEach(() => invoke.mockReset())

  it('sends the revoke action', async () => {
    invoke.mockResolvedValue({ data: { ok: true, acknowledgement: null }, error: null })
    await revokeSetupStep(3, 'wifi_walked')
    expect(invoke).toHaveBeenCalledWith('mutate-warehouse-setup-ack', {
      body: { action: 'revoke', warehouse_id: 3, step_key: 'wifi_walked' },
    })
  })

  it('surfaces the server message on failure', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(404, {
        error: { code: 'NOT_FOUND', message: '"wifi_walked" was not signed off for MAIN' },
      }),
    })
    await expect(revokeSetupStep(3, 'wifi_walked')).rejects.toThrow('was not signed off for MAIN')
  })
})

describe('reads', () => {
  beforeEach(() => from.mockReset())

  it('adapts acknowledgement rows and tolerates a missing note', async () => {
    from.mockReturnValue({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: [{ id: 1, warehouse_id: 3, step_key: 'wifi_walked', acknowledged_at: '2026-08-03' }],
            error: null,
          }),
      }),
    })

    const rows = await getSetupAcks(3)
    expect(rows).toEqual([
      {
        id: 1,
        warehouseId: 3,
        stepKey: 'wifi_walked',
        note: null,
        // Nullable on purpose: deleting a profile must not lose the fact that
        // the step was signed off.
        acknowledgedBy: null,
        acknowledgedAt: '2026-08-03',
      },
    ])
  })

  it('returns a head-count for replenishment coverage, and 0 when null', async () => {
    const chain = (count: number | null) => ({
      select: () => ({ eq: () => ({ eq: () => Promise.resolve({ count, error: null }) }) }),
    })

    from.mockReturnValue(chain(25))
    await expect(countReplenConfigured(3)).resolves.toBe(25)

    from.mockReturnValue(chain(null))
    await expect(countReplenConfigured(3)).resolves.toBe(0)
  })
})
