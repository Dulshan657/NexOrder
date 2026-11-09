import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase client singleton before importing the service.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke } },
}))

import { getHomeBinChoices, getHomeBinHealth } from '../services/supabase/homeBinHealthService'

function httpError(status: number, body: unknown): Error {
  // Mirror supabase-js FunctionsHttpError: a generic message plus the raw
  // Response (carrying the structured body) on `.context`.
  const err = new Error('Edge Function returned a non-2xx status code')
  ;(err as Error & { context: Response }).context = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return err
}

describe('getHomeBinHealth', () => {
  beforeEach(() => invoke.mockReset())

  it('asks home-bin-health with GET and the warehouse in the query string', async () => {
    invoke.mockResolvedValue({ data: { ok: true, warehouseId: 7, checked: 0, rows: [] }, error: null })
    await getHomeBinHealth(7)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('home-bin-health?warehouseId=7', { method: 'GET' })
  })

  it('returns the homes with problems, and how many were checked', async () => {
    const rows = [{
      productId: 1, sku: 'TST-HOME-200', binId: 20, binCode: 'TST-A-01-1',
      problems: [{ code: 'inactive', message: 'Bin TST-A-01-1 is inactive, so putaway never offers it.' }],
    }]
    invoke.mockResolvedValue({ data: { ok: true, warehouseId: 7, checked: 12, rows }, error: null })
    expect(await getHomeBinHealth(7)).toEqual({ warehouseId: 7, checked: 12, rows })
  })

  it('reads a clean warehouse as no rows', async () => {
    invoke.mockResolvedValue({ data: { ok: true, warehouseId: 7, checked: 3, rows: [] }, error: null })
    expect(await getHomeBinHealth(7)).toEqual({ warehouseId: 7, checked: 3, rows: [] })
  })

  it('tolerates a reply with no rows or count', async () => {
    invoke.mockResolvedValue({ data: { ok: true, warehouseId: 7 }, error: null })
    expect(await getHomeBinHealth(7)).toEqual({ warehouseId: 7, checked: 0, rows: [] })
  })

  it('surfaces the server message on a failure, not the generic non-2xx one', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(500, { error: { code: 'INTERNAL', message: 'Could not check home bins, try again.' } }),
    })
    await expect(getHomeBinHealth(7)).rejects.toThrow('Could not check home bins, try again.')
  })

  it('falls back to a readable message when the body carries none', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(500, { nope: true }) })
    await expect(getHomeBinHealth(7)).rejects.toThrow('Could not check the home bins')
  })

  it('throws when the call succeeds but returns nothing', async () => {
    invoke.mockResolvedValue({ data: null, error: null })
    await expect(getHomeBinHealth(7)).rejects.toThrow('Could not check the home bins')
  })
})

describe('getHomeBinChoices', () => {
  beforeEach(() => invoke.mockReset())

  it('GETs home-bin-choices with both ids in the query string', async () => {
    invoke.mockResolvedValue({ data: { ok: true, warehouseId: 7, productId: 3, bins: [] }, error: null })
    await getHomeBinChoices(7, 3)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('home-bin-choices?warehouseId=7&productId=3', { method: 'GET' })
  })

  it('adds the line being placed to the query string, so its own space is not counted', async () => {
    invoke.mockResolvedValue({ data: { ok: true, warehouseId: 7, productId: 3, bins: [] }, error: null })
    await getHomeBinChoices(7, 3, 55)
    expect(invoke).toHaveBeenCalledWith(
      'home-bin-choices?warehouseId=7&productId=3&recommendationId=55', { method: 'GET' })
  })

  it('returns the bins the server offers', async () => {
    const bins = [
      { binId: 21, binCode: 'TST-WALK-B1', binName: null },
      { binId: 22, binCode: 'TST-WALK-B2', binName: 'Bay two' },
    ]
    invoke.mockResolvedValue({ data: { ok: true, warehouseId: 7, productId: 3, bins }, error: null })
    expect(await getHomeBinChoices(7, 3)).toEqual(bins)
  })

  it('tolerates a reply with no bins', async () => {
    invoke.mockResolvedValue({ data: { ok: true, warehouseId: 7, productId: 3 }, error: null })
    expect(await getHomeBinChoices(7, 3)).toEqual([])
  })

  it('surfaces the server message on a failure, not the generic non-2xx one', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(500, { error: { code: 'INTERNAL', message: 'Could not list bins for a home, try again.' } }),
    })
    await expect(getHomeBinChoices(7, 3)).rejects.toThrow('Could not list bins for a home, try again.')
  })

  it('falls back to a readable message when the body carries none', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(500, { nope: true }) })
    await expect(getHomeBinChoices(7, 3)).rejects.toThrow('Could not list the bins for a home')
  })

  it('throws when the call succeeds but returns nothing', async () => {
    invoke.mockResolvedValue({ data: null, error: null })
    await expect(getHomeBinChoices(7, 3)).rejects.toThrow('Could not list the bins for a home')
  })
})
