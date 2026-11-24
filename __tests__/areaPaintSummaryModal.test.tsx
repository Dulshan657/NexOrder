// NX-0046 A2: a retry of the annotation save sends only what did not save.
//
// Signs are written first, areas second. When the area write failed, pressing
// Save again used to re-send the signs against the fingerprint the first attempt
// had already moved — a conflict, every time.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const paintAreas = vi.fn()
const paintSigns = vi.fn()
const addToast = vi.fn()

vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  usePaintAreas: () => ({ mutateAsync: paintAreas, isPending: false }),
  usePaintSigns: () => ({ mutateAsync: paintSigns, isPending: false }),
}))
vi.mock('@/hooks/useToasts', () => ({ useToastActions: () => ({ addToast }) }))
vi.mock('@/services/supabase/warehouseLocationService', () => ({
  previewPaintAreas: vi.fn().mockResolvedValue({
    created: ['Fast'], erased: [], resized: [], reprofiled: [], cellsAfter: 1, unchanged: false,
    willRename: 0, racks: 0, levels: 0, skippedCustom: 0, skippedForeign: 0, examples: [],
    willBind: 0, bindLevels: 0, unbind: 0, categoryWarnings: [],
  }),
  previewPaintSigns: vi.fn().mockResolvedValue({
    created: ['Dock'], erased: [], resized: [], cellsAfter: 1, unchanged: false,
  }),
}))

import { AreaPaintSummaryModal } from '@/components/inventory/warehouse/AreaPaintSummaryModal'

afterEach(() => cleanup())
beforeEach(() => {
  paintAreas.mockReset()
  paintSigns.mockReset()
  addToast.mockReset()
})

function renderModal(onSaved = vi.fn()) {
  render(
    <AreaPaintSummaryModal
      warehouseId={1}
      layoutId={2}
      baseFingerprint="areas-0"
      specs={[{ name: 'Fast', zoneProfileId: null, cells: [{ floor: 0, x: 1, y: 1 }] }] as never}
      signSpecs={[{ name: 'Dock', cells: [{ floor: 0, x: 3, y: 3 }] }] as never}
      signBaseFingerprint="signs-0"
      floorCount={1}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  return onSaved
}

const save = () => screen.getByRole('button', { name: 'Save annotations' })

describe('AreaPaintSummaryModal', () => {
  it('a retry after the area save failed does not send the signs again', async () => {
    paintSigns.mockResolvedValue({ fingerprint: 'signs-1', cells: 1, signs: 1 })
    paintAreas.mockRejectedValueOnce(new Error('Someone else changed the areas'))
    paintAreas.mockResolvedValueOnce({ fingerprint: 'areas-1', cells: 1, areas: 1, renamed: 0 })
    const onSaved = renderModal()
    await screen.findByText(/New sign/)
    await screen.findByText(/New area/)

    fireEvent.click(save())
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Someone else changed the areas', 'error'))
    expect(paintSigns).toHaveBeenCalledTimes(1)

    fireEvent.click(save())
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(paintAreas).toHaveBeenCalledTimes(2)
    expect(paintSigns).toHaveBeenCalledTimes(1)
    // The operator is told both halves landed, not just the half this click sent.
    expect(addToast).toHaveBeenLastCalledWith('Areas and signs saved', 'success')
  })

  it('sends the signs again when it was the sign save that failed', async () => {
    paintSigns.mockRejectedValueOnce(new Error('Could not save the signs'))
    paintSigns.mockResolvedValueOnce({ fingerprint: 'signs-1', cells: 1, signs: 1 })
    paintAreas.mockResolvedValue({ fingerprint: 'areas-1', cells: 1, areas: 1, renamed: 0 })
    const onSaved = renderModal()
    await screen.findByText(/New sign/)
    await screen.findByText(/New area/)

    fireEvent.click(save())
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Could not save the signs', 'error'))
    expect(paintAreas).not.toHaveBeenCalled()

    fireEvent.click(save())
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(paintSigns).toHaveBeenCalledTimes(2)
  })
})
