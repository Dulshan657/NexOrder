import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// NX-0032: recommend-putaway now accepts the plate (hu_id), plate type and hold
// flag of each line, so the receive screen's Retry can send back exactly what
// receive-stock tried. A caller-supplied hu_id becomes handling_unit_id on a
// task, which drains that plate when it is put away, so it is only accepted
// when the plate really is on the receipt the request names.
import {
  assertPlatesOnReceipt,
  unownedPlateIds,
} from '../supabase/functions/_shared/putawayPlateOwnership'
import { EdgeFunctionError } from '../supabase/functions/_shared/errors'

/** A client whose handling_units read answers with `rows` (or `error`). */
function adminReading(reply: { rows?: Array<{ id: number }>; error?: { message: string } }) {
  const inCall = vi.fn()
  const eqCall = vi.fn()
  const chain = {
    eq: (...args: unknown[]) => {
      eqCall(...args)
      return chain
    },
    in: (...args: unknown[]) => {
      inCall(...args)
      return Promise.resolve({ data: reply.error ? null : reply.rows ?? [], error: reply.error ?? null })
    },
  }
  const from = vi.fn(() => ({ select: vi.fn(() => chain) }))
  return { admin: { from } as unknown as Parameters<typeof assertPlatesOnReceipt>[0], from, eqCall, inCall }
}

async function refusal(promise: Promise<void>): Promise<EdgeFunctionError> {
  const err = await promise.then(() => null, (e: unknown) => e)
  expect(err).toBeInstanceOf(EdgeFunctionError)
  return err as EdgeFunctionError
}

describe('unownedPlateIds', () => {
  it('lists the requested plates the receipt does not own', () => {
    expect(unownedPlateIds([900, 901, 902], [900, 902])).toEqual([901])
  })

  it('is empty when the receipt owns them all, and when none were asked for', () => {
    expect(unownedPlateIds([900, 901], new Set([901, 900]))).toEqual([])
    expect(unownedPlateIds([], [])).toEqual([])
  })

  it('counts a plate once however many lines name it', () => {
    expect(unownedPlateIds([900, 900, 901, 901], [900])).toEqual([901])
  })
})

describe('assertPlatesOnReceipt', () => {
  let logged: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    logged.mockRestore()
  })

  it('asks nothing when no line names a plate', async () => {
    const { admin, from } = adminReading({})
    await assertPlatesOnReceipt(admin, undefined, [{ product_id: 1, hu_id: undefined }, { product_id: 2, hu_id: undefined }])
    await assertPlatesOnReceipt(admin, 501, [{ product_id: 1, hu_id: undefined }])
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts plates that are on the receipt', async () => {
    const { admin, from, eqCall, inCall } = adminReading({ rows: [{ id: 900 }, { id: 901 }] })
    await assertPlatesOnReceipt(admin, 501, [
      { hu_id: 900 },
      { hu_id: 901 },
      { hu_id: 900 },
    ])
    expect(from).toHaveBeenCalledWith('handling_units')
    expect(eqCall).toHaveBeenCalledWith('goods_receipt_id', 501)
    // Each plate once, even when several lines share it (a mixed pallet).
    expect(inCall).toHaveBeenCalledWith('id', [900, 901])
  })

  it('refuses a plate that is not on the receipt, naming it', async () => {
    const { admin } = adminReading({ rows: [{ id: 900 }] })
    const err = await refusal(assertPlatesOnReceipt(admin, 501, [{ hu_id: 900 }, { hu_id: 777 }]))
    expect(err.code).toBe('INVALID_INPUT')
    expect(err.message).toContain('777')
    expect(err.message).not.toContain('900')
  })

  it('refuses a plate when no receipt was named, without asking the database', async () => {
    const { admin, from } = adminReading({ rows: [{ id: 900 }] })
    const err = await refusal(assertPlatesOnReceipt(admin, undefined, [{ hu_id: 900 }]))
    expect(err.code).toBe('INVALID_INPUT')
    expect(from).not.toHaveBeenCalled()
  })

  it('fails closed when the plates cannot be read', async () => {
    const { admin } = adminReading({ error: { message: 'boom' } })
    const err = await refusal(assertPlatesOnReceipt(admin, 501, [{ hu_id: 900 }]))
    expect(err.code).toBe('INTERNAL')
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })
})
