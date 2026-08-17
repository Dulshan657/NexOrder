// The recode wire body.
//
// One builder serves both the preview and the write, because the previewed count has
// to BE the count that moves and two builders drift. This pins the parts of that
// contract a type cannot state: which fields are sent as an explicit `null` (the
// server declares them `.nullish()`, and null is the honest wire value for "you
// decide"), and which are omitted entirely.
//
// The distinction matters. `.optional()` accepts `undefined` and REJECTS `null` in
// zod, and with `strict` off nothing in this repo will tell you which one a field
// has — that mismatch is what made every Shelving rack save fail with a bare
// "Invalid request body" once before.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}))

import { previewRecode, recodeLocations } from '@/services/supabase/warehouseLocationService'

const args = {
  warehouseId: 7,
  units: [{ locationId: 11, expectedCode: 'AMD-B-3-3' }],
  block: 'BULK',
}

const bodyOf = () => invoke.mock.calls[0][1].body

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { ok: true, preview: {} }, error: null })
})

describe('recodeBody', () => {
  it('sends dry_run only on the preview', async () => {
    await previewRecode(args)
    expect(bodyOf().dry_run).toBe(true)

    invoke.mockReset()
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await recodeLocations(args)
    expect(bodyOf()).not.toHaveProperty('dry_run')
  })

  it('is otherwise IDENTICAL between preview and write', async () => {
    await previewRecode(args)
    const { dry_run: _drop, ...preview } = bodyOf()

    invoke.mockReset()
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await recodeLocations(args)
    expect(bodyOf()).toEqual(preview)
  })

  // `.nullish()` on the server: null is "you decide", undefined would be rejected.
  it('sends an explicit null for every field the server may default', async () => {
    await previewRecode(args)
    const body = bodyOf()
    expect(body.start_at).toBeNull()
    expect(body.template_override).toBeNull()
    expect(body.order).toBeNull()
    expect(body.origin).toBeNull()
  })

  it('maps units to the snake_case compare-and-swap shape', async () => {
    await previewRecode(args)
    expect(bodyOf().units).toEqual([{ location_id: 11, expected_code: 'AMD-B-3-3' }])
  })

  it('forwards an armed origin rather than nulling it', async () => {
    await previewRecode({ ...args, origin: 'se' })
    expect(bodyOf().origin).toBe('se')
  })

  // `.optional()` on the server, and it only ever means "yes, deliberately" — so an
  // un-armed renumber must not appear on the wire as `false`.
  it('omits renumber_block entirely unless it is armed', async () => {
    await previewRecode(args)
    expect(bodyOf()).not.toHaveProperty('renumber_block')

    invoke.mockReset()
    invoke.mockResolvedValue({ data: { ok: true, preview: {} }, error: null })
    await previewRecode({ ...args, renumberBlock: false })
    expect(bodyOf()).not.toHaveProperty('renumber_block')

    invoke.mockReset()
    invoke.mockResolvedValue({ data: { ok: true, preview: {} }, error: null })
    await previewRecode({ ...args, renumberBlock: true })
    expect(bodyOf().renumber_block).toBe(true)
  })
})
