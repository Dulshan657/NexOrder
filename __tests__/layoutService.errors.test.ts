import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase client singleton before importing the service.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke } },
}))

import { saveGeometry, publishLayout, createLayout } from '../services/supabase/layoutService'
import { describeValidationIssues } from '../lib/functionError'

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

describe('layoutService error surfacing', () => {
  beforeEach(() => invoke.mockReset())

  // The regression this exists for: saveGeometry used to `throw error` raw, so a
  // 400 from mutate-layout reached the operator as "Edge Function returned a
  // non-2xx status code" and there was no way to tell a duplicate bin from a bad
  // level role from a stale draft.
  it('surfaces the server message on a failed save', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(400, { error: { code: 'INVALID_INPUT', message: 'A bin appears twice in the layout' } }),
    })
    await expect(saveGeometry(78, [], [])).rejects.toThrow('A bin appears twice in the layout')
  })

  it('does not leak the generic non-2xx message on a failed save', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(409, { error: { code: 'CONFLICT', message: 'Layout is published; only drafts can be edited' } }),
    })
    await expect(saveGeometry(78, [], [])).rejects.not.toThrow(/non-2xx/)
  })

  it('surfaces the server message on a failed publish', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(500, { error: { code: 'INTERNAL', message: 'publish failed: STOCK_IN_REMOVED_BIN' } }),
    })
    await expect(publishLayout(78)).rejects.toThrow('publish failed: STOCK_IN_REMOVED_BIN')
  })

  it('falls back to a readable message when the body carries no message', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(500, { nope: true }) })
    await expect(createLayout({ warehouse_id: 1, name: 'x' })).rejects.toThrow('Could not create the layout')
  })

  it('passes a successful save straight through', async () => {
    invoke.mockResolvedValue({ data: { ok: true, layout_id: 78, ref_map: [] }, error: null })
    await expect(saveGeometry(78, [], [])).resolves.toMatchObject({ layout_id: 78 })
  })

  // "Invalid request body" is true and useless. mutate-layout attaches the paths
  // that failed; reading them is the difference between a four-word dead end and
  // knowing which field of which placement the server refused.
  it('names the offending field when the failure was schema validation', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(400, {
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid request body',
          details: {
            issues: [
              { path: 'placements.14.new_bin.levels.0.weight_capacity_kg', message: 'Expected number, received null' },
            ],
          },
        },
      }),
    })
    await expect(saveGeometry(78, [], [])).rejects.toThrow(
      'Invalid request body — placements.14.new_bin.levels.0.weight_capacity_kg: Expected number, received null',
    )
  })

  it('leaves a message with no validation details unchanged', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(400, { error: { code: 'INVALID_INPUT', message: 'A bin appears twice in the layout', details: { foo: 1 } } }),
    })
    await expect(saveGeometry(78, [], [])).rejects.toThrow(/^A bin appears twice in the layout$/)
  })
})

describe('describeValidationIssues', () => {
  it('caps the suffix at the first three issues', () => {
    const issues = Array.from({ length: 5 }, (_, i) => ({ path: `p.${i}`, message: 'bad' }))
    expect(describeValidationIssues({ issues })).toBe('p.0: bad; p.1: bad; p.2: bad')
  })

  it('returns empty string for anything that is not an issue list', () => {
    // Callers append it unconditionally, so it must be total.
    for (const details of [undefined, null, {}, { issues: 'nope' }, 42]) {
      expect(describeValidationIssues(details)).toBe('')
    }
  })

  it('survives a malformed issue entry', () => {
    expect(describeValidationIssues({ issues: [null, { path: 'a' }, { message: 'b' }] })).toBe('a; b')
  })
})
