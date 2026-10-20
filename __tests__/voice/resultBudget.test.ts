import { describe, it, expect } from 'vitest'
import { MAX_RESULT_CHARS, fitToBudget } from '../../lib/voice/resultBudget'
import type { VoiceToolResult } from '../../lib/voice/runVoiceTool'
import { deepFreeze } from './voiceFixtures'

const success = (data: unknown): VoiceToolResult => ({ ok: true, basis: 'b', asOf: '2026-10-20T04:00:00.000Z', data })
const sizeOf = (result: VoiceToolResult): number => JSON.stringify(result).length
const rows = (n: number): Array<{ name: string; n: number }> => Array.from({ length: n }, (_, i) => ({ name: `row number ${i}`, n: i }))

describe('fitToBudget', () => {
  it('is 4,000 characters, the figure the brief set', () => {
    expect(MAX_RESULT_CHARS).toBe(4000)
  })

  it('hands back a result that already fits, untouched', () => {
    const small = success({ rows: rows(3) })
    expect(fitToBudget(small, 500)).toBe(small)
  })

  it('accepts a result of exactly the budget', () => {
    const result = success({ rows: rows(4) })
    expect(fitToBudget(result, sizeOf(result))).toBe(result)
  })

  it('halves every array until the result fits, keeping the head of each', () => {
    const result = success({ customers: rows(40), products: rows(20), total: 40 })
    const fitted = fitToBudget(result, 700)
    expect(sizeOf(fitted)).toBeLessThanOrEqual(700)
    if (fitted.ok === false) throw new Error('should still be ok')
    const data = fitted.data as { customers: Array<{ n: number }>; products: Array<{ n: number }>; total: number; truncated: boolean }
    expect(data.customers.length).toBeLessThan(40)
    expect(data.customers.map((c) => c.n)).toEqual(Array.from({ length: data.customers.length }, (_, i) => i))
    expect(data.products.length).toBeLessThan(20)
    expect(data.total).toBe(40)
    expect(data.truncated).toBe(true)
  })

  it('halves arrays nested inside rows too', () => {
    const result = success({ groups: [{ name: 'g', items: rows(60) }] })
    const fitted = fitToBudget(result, 500)
    expect(sizeOf(fitted)).toBeLessThanOrEqual(500)
    if (fitted.ok === false) throw new Error('should still be ok')
    expect((fitted.data as { groups: Array<{ items: unknown[] }> }).groups[0].items.length).toBeLessThan(60)
  })

  it('halves a bare array result without adding a flag it has nowhere to put', () => {
    const fitted = fitToBudget(success(rows(80)), 600)
    expect(sizeOf(fitted)).toBeLessThanOrEqual(600)
    expect(fitted.ok === true && Array.isArray(fitted.data)).toBe(true)
  })

  it('keeps basis and asOf, which the model must always be able to read', () => {
    const fitted = fitToBudget(success({ rows: rows(100) }), 400)
    expect(fitted).toMatchObject({ ok: true, basis: 'b', asOf: '2026-10-20T04:00:00.000Z' })
  })

  it('does not modify what it is given', () => {
    const result = deepFreeze(success({ rows: rows(100) }))
    expect(() => fitToBudget(result, 400)).not.toThrow()
    expect((result as { data: { rows: unknown[] } }).data.rows).toHaveLength(100)
  })

  it('gives up with an error rather than returning something over the cap', () => {
    const fitted = fitToBudget(success({ blob: 'x'.repeat(900) }), 300)
    expect(fitted).toEqual({ ok: false, error: 'Result too large' })
  })

  it('leaves an error result alone', () => {
    const failure: VoiceToolResult = { ok: false, error: 'Unknown customer' }
    expect(fitToBudget(failure, 5)).toBe(failure)
  })
})
