import { beforeEach, describe, expect, it, vi } from 'vitest'

// The assigned-reps calls (mig 00129): reads the staff-only `horeca_reps` table and
// writes through mutate-horeca `set_reps`.

const { invoke, from } = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke }, from },
}))

import { listHorecaReps, setHorecaReps } from '../services/supabase/horecaService'

function httpError(status: number, body: unknown): Error {
  const err = new Error('Edge Function returned a non-2xx status code')
  ;(err as Error & { context: Response }).context = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return err
}

beforeEach(() => {
  invoke.mockReset()
  from.mockReset()
})

describe('listHorecaReps', () => {
  it('reads the rep ids for one venue', async () => {
    const eq = vi.fn().mockResolvedValue({ data: [{ rep_id: 'r1' }, { rep_id: 'r2' }], error: null })
    const select = vi.fn().mockReturnValue({ eq })
    from.mockReturnValue({ select })

    await expect(listHorecaReps(7)).resolves.toEqual(['r1', 'r2'])
    expect(from).toHaveBeenCalledWith('horeca_reps')
    expect(select).toHaveBeenCalledWith('rep_id')
    expect(eq).toHaveBeenCalledWith('horeca_id', 7)
  })

  it('an empty table is an empty list, and a read error is thrown as it is', async () => {
    const eq = vi.fn().mockResolvedValueOnce({ data: null, error: null })
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) })
    await expect(listHorecaReps(7)).resolves.toEqual([])

    const boom = { message: 'permission denied' }
    eq.mockResolvedValueOnce({ data: null, error: boom })
    await expect(listHorecaReps(7)).rejects.toBe(boom)
  })
})

describe('setHorecaReps', () => {
  it('sends the COMPLETE set to set_reps and returns what is stored', async () => {
    invoke.mockResolvedValue({ data: { ok: true, horecaId: 7, repIds: ['r1'] }, error: null })

    await expect(setHorecaReps(7, ['r1'], 'new territory')).resolves.toEqual(['r1'])

    expect(invoke).toHaveBeenCalledWith('mutate-horeca', {
      body: { action: 'set_reps', horecaId: 7, repIds: ['r1'], reason: 'new territory' },
    })
  })

  it('an empty list is sent as an empty list: that is how everyone is unassigned', async () => {
    invoke.mockResolvedValue({ data: { ok: true, horecaId: 7, repIds: [] }, error: null })

    await setHorecaReps(7, [])

    expect(invoke.mock.calls[0][1].body.repIds).toEqual([])
  })

  it('surfaces the server\'s reason, not "non-2xx status code"', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(400, {
        error: { code: 'INVALID_INPUT', message: 'Only Field Sales Reps and Office Sales Reps can be assigned to a HoReCa' },
      }),
    })

    await expect(setHorecaReps(7, ['customer-id'])).rejects.toThrow(
      'Only Field Sales Reps and Office Sales Reps can be assigned to a HoReCa',
    )
  })
})
