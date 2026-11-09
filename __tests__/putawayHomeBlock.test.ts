import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// NX-0032: the edge functions' pre-check (_shared/putawayHomeBlock.ts). It turns
// wie_home_block's answer into the error the floor reads, and fails closed when
// the answer cannot be read. The rpc is stubbed; the rule itself is tested in
// homeBinEnforced.integration.test.ts.
import { HOME_UNAVAILABLE, refuseIfHomeBlocked } from '../supabase/functions/_shared/putawayHomeBlock'
import { EdgeFunctionError } from '../supabase/functions/_shared/errors'

const HOME_MESSAGE =
  'Put this in its home bin TST-HOME-H-1; it still has room for 10. If it is full, ask a manager to set its maximum.'

function adminReplying(reply: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: reply.data ?? null, error: reply.error ?? null })
  // The helper only ever calls .rpc; the rest of the client is not needed.
  return { admin: { rpc } as unknown as Parameters<typeof refuseIfHomeBlocked>[0], rpc }
}

async function refusal(promise: Promise<void>): Promise<EdgeFunctionError> {
  const err = await promise.then(() => null, (e: unknown) => e)
  expect(err).toBeInstanceOf(EdgeFunctionError)
  return err as EdgeFunctionError
}

describe('refuseIfHomeBlocked', () => {
  let logged: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    logged.mockRestore()
  })

  it('asks wie_home_block about this task and bin', async () => {
    const { admin, rpc } = adminReplying({ data: null })
    await refuseIfHomeBlocked(admin, 7, 3)
    expect(rpc).toHaveBeenCalledWith('wie_home_block', { p_rec_id: 7, p_to_location_id: 3 })
  })

  it('lets NULL through (allowed) without logging', async () => {
    const { admin } = adminReplying({ data: null })
    await expect(refuseIfHomeBlocked(admin, 7, 3)).resolves.toBeUndefined()
    expect(logged).not.toHaveBeenCalled()
  })

  it('turns the refusal text into CONFLICT with exactly those words', async () => {
    const { admin } = adminReplying({ data: HOME_MESSAGE })
    const err = await refusal(refuseIfHomeBlocked(admin, 7, 3))
    expect(err.code).toBe('CONFLICT')
    expect(err.status).toBe(409)
    expect(err.message).toBe(HOME_MESSAGE)
  })

  it('fails closed on an rpc error: INTERNAL, the fixed copy, detail only in the log', async () => {
    const { admin } = adminReplying({ error: { message: 'function wie_home_block does not exist' } })
    const err = await refusal(refuseIfHomeBlocked(admin, 7, 3))
    expect(err.code).toBe('INTERNAL')
    expect(err.message).toBe('Home bin unavailable, try again.')
    expect(err.message).toBe(HOME_UNAVAILABLE)
    expect(err.message).not.toContain('wie_home_block')
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('function wie_home_block does not exist'))
  })

  it.each([
    ['an object', { message: HOME_MESSAGE }],
    ['a number', 0],
    ['true', true],
    ['false', false],
    ['an array', [HOME_MESSAGE]],
    ['an empty string', ''],
  ])('fails closed on %s: not null, not a refusal text', async (_label, data) => {
    const { admin } = adminReplying({ data })
    const err = await refusal(refuseIfHomeBlocked(admin, 7, 3))
    expect(err.code).toBe('INTERNAL')
    expect(err.message).toBe(HOME_UNAVAILABLE)
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('unexpected reply'))
  })
})
