// Narrowing a layout label run to a specific set of locations.
//
// The recode hand-off needs "print exactly the bins I just swept". The property
// that makes that safe is that `locationIds` NARROWS the server's own selection
// rather than supplying one: `wie_layout_label_targets` still decides what a label
// target is — which kinds, which levels, what context each sticker carries — so a
// caller cannot smuggle in a location the layout does not own, and an id that has
// since been deactivated simply drops out.
//
// The same filter exists in generate-labels. It has to, or the preview would count
// one run and the PDF would render another.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: vi.fn() },
  },
}))

import { getLayoutLabelTargets } from '@/services/supabase/labelService'

const row = (locationId: number, code: string, kind = 'BIN') => ({
  location_id: locationId, code, kind, name: null, zone_name: null,
  aisle_code: null, level_role_name: null, level_index: null, label_printed: false,
})

const allCodes = (sheets: Array<{ items: Array<{ code: string }> }>) =>
  sheets.flatMap((s) => s.items.map((i) => i.code)).sort()

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({
    data: [row(1, 'AMD-BULK-1-1'), row(2, 'AMD-BULK-1-2'), row(3, 'AMD-COLD-1-1')],
    error: null,
  })
})

describe('getLayoutLabelTargets', () => {
  it('plans the whole layout when no ids are given', async () => {
    expect(allCodes(await getLayoutLabelTargets(5)))
      .toEqual(['AMD-BULK-1-1', 'AMD-BULK-1-2', 'AMD-COLD-1-1'])
  })

  it('narrows to the ids it is given', async () => {
    expect(allCodes(await getLayoutLabelTargets(5, { locationIds: [1, 2] })))
      .toEqual(['AMD-BULK-1-1', 'AMD-BULK-1-2'])
  })

  // An empty array is "no restriction", not "print nothing" — a caller whose
  // selection has not loaded yet must not silently produce an empty run.
  it('treats an empty id list as no restriction', async () => {
    expect(allCodes(await getLayoutLabelTargets(5, { locationIds: [] }))).toHaveLength(3)
  })

  // The safety property: ids cannot ADD anything the RPC did not return.
  it('cannot introduce a location the layout does not own', async () => {
    expect(allCodes(await getLayoutLabelTargets(5, { locationIds: [1, 999] })))
      .toEqual(['AMD-BULK-1-1'])
  })

  it('still asks the server for the whole layout, and filters after', async () => {
    await getLayoutLabelTargets(5, { locationIds: [1] })
    expect(rpc).toHaveBeenCalledWith('wie_layout_label_targets', expect.objectContaining({
      p_layout_id: 5,
    }))
  })
})
