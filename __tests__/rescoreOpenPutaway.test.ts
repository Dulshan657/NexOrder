import { describe, expect, it, vi } from 'vitest'
import {
  buildRescoreBody,
  rescoreRow,
  formatSkippedSummary,
} from '../supabase/ops/rescoreRows.mjs'

// NX-0032 final review I2: rescore-open-putaway.mjs re-scores each open task
// through recommend-putaway. Since NX-0032 that function refuses an hu_id that
// is not on goods_receipt_id, and a refused row used to throw and stop the
// whole run part-way. Now: the plate goes along only with its receipt, and a
// refused row is logged, skipped and summarised. Made-up ids only.

describe('buildRescoreBody', () => {
  const plate = { id: 77, hu_type: 'pallet' }

  it('sends the plate with its receipt', () => {
    const body = buildRescoreBody({
      warehouseId: 5,
      rowId: 900,
      cur: { product_id: 300, quantity: '12', goods_receipt_id: 41 },
      hu: plate,
    })
    expect(body).toEqual({
      warehouse_id: 5,
      goods_receipt_id: 41,
      replaces_recommendation_id: 900,
      lines: [{ product_id: 300, quantity: 12, hu_id: 77, hu_type: 'pallet' }],
    })
  })

  it('leaves the plate out when the task has no receipt', () => {
    const body = buildRescoreBody({
      warehouseId: 5,
      rowId: 901,
      cur: { product_id: 300, quantity: 4, goods_receipt_id: null },
      hu: plate,
    })
    expect(body.goods_receipt_id).toBeUndefined()
    expect(body.lines[0]).toEqual({ product_id: 300, quantity: 4 })
    expect('hu_id' in body.lines[0]).toBe(false)
    expect('hu_type' in body.lines[0]).toBe(false)
  })

  it('sends no plate fields when there is no plate', () => {
    const body = buildRescoreBody({
      warehouseId: 5, rowId: 902, cur: { product_id: 300, quantity: 2, goods_receipt_id: 41 }, hu: null,
    })
    expect(body.lines[0]).toEqual({ product_id: 300, quantity: 2 })
  })
})

describe('rescoreRow', () => {
  const body = { warehouse_id: 5, replaces_recommendation_id: 900, lines: [] }

  it('returns the rows the engine wrote', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { recommendations: [{ recommendedLocationId: 11 }, { recommendedLocationId: null }] },
      error: null,
    })
    const r = await rescoreRow(invoke, 900, body)
    expect(invoke).toHaveBeenCalledWith('recommend-putaway', { body })
    expect(r).toEqual({ ok: true, recs: [{ recommendedLocationId: 11 }, { recommendedLocationId: null }] })
  })

  it("reads a refused row's reason from the response body and does not throw", async () => {
    const context = new Response(
      JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'hu_id 77 is not on goods receipt 41' } }),
      { status: 400 },
    )
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context }),
    })
    const r = await rescoreRow(invoke, 900, body)
    expect(r).toEqual({ ok: false, skipped: { id: 900, reason: 'hu_id 77 is not on goods receipt 41' } })
  })

  it("falls back to the error's own message when there is no body", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: new Error('fetch failed') })
    expect(await rescoreRow(invoke, 903, body)).toEqual({ ok: false, skipped: { id: 903, reason: 'fetch failed' } })
  })

  it('treats a thrown invoke as a skipped row too', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('socket hang up'))
    expect(await rescoreRow(invoke, 904, body)).toEqual({ ok: false, skipped: { id: 904, reason: 'socket hang up' } })
  })
})

describe('formatSkippedSummary', () => {
  it('says nothing was skipped', () => {
    expect(formatSkippedSummary([])).toEqual(['[rescore] skipped 0 task(s).'])
  })

  it('lists each skipped task with its reason', () => {
    expect(formatSkippedSummary([
      { id: 900, reason: 'hu_id 77 is not on goods receipt 41' },
      { id: 903, reason: 'fetch failed' },
    ])).toEqual([
      '[rescore] skipped 2 task(s); not re-scored, still open on the queue:',
      '  900: hu_id 77 is not on goods receipt 41',
      '  903: fetch failed',
    ])
  })
})
