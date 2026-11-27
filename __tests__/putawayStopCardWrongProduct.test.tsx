// NX-0050: "Not this product?" on a putaway Walk stop.
//
// The carton on the stop is not what its label says. The walker picks the
// real product and counts it; the card sends both to report-wrong-product and
// the stop is done (its stock is now the real product, held). Made-up data.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { reportMock, doneSpy } = vi.hoisted(() => ({ reportMock: vi.fn(), doneSpy: vi.fn() }))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useCompletePutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmOverflow: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReportWrongProduct: () => ({ mutateAsync: reportMock, isPending: false }),
}))
vi.mock('@/hooks/queries/usePalletBreakdown', () => ({
  usePrintPlateLabels: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePlanBreakdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBreakDownPallet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useToasts', () => ({
  useToasts: () => ({ addToast: vi.fn() }),
  useToastActions: () => ({ addToast: vi.fn() }),
}))
vi.mock('@/hooks/queries/useProducts', () => ({
  useProducts: () => ({
    data: [
      { id: 77, sku: 'TST-CHL-200', name: 'Test Chilli Powder 200g', barcode: '9999000000139', price: 1, category: 'Other', inventory: 0, unit: 'each', carton_size: 40 },
      { id: 78, sku: 'TST-GRK-100', name: 'Test Goraka 100g', barcode: '9999000000511', price: 1, category: 'Other', inventory: 0, unit: 'each', carton_size: 70 },
    ],
    isLoading: false,
  }),
}))

import { PutawayStopCard } from '@/components/inventory/putaway/PutawayStopCard'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

function row(): PendingPutawayRow {
  return {
    id: 901, productId: 77, quantity: 40, recommendedLocationId: 5001,
    explanation: { engineVersion: 'v1', layoutId: 1, candidatesConsidered: 3, hardFilters: [], winner: null, alternatives: [] },
    createdAt: '2026-11-27T00:00:00Z',
    product: { id: 77, name: 'Test Chilli Powder 200g', sku: 'TST-CHL-200', barcode: null } as Product,
    receipt: null, huId: null, huType: null, huCode: null, huLabelPrinted: null, huStatus: null,
    status: 'assigned', assignedLocationId: 5001, assignedAt: '2026-11-27T00:01:00Z', suggestionSource: 'engine',
  }
}

afterEach(() => {
  cleanup()
  reportMock.mockReset()
  doneSpy.mockReset()
})

describe('PutawayStopCard', () => {
  it('Not this product? reports the real product and the counted quantity', async () => {
    reportMock.mockResolvedValue({ mismatchId: 5, heldTasks: [] })
    render(
      <PutawayStopCard
        row={row()} bin={{ code: 'TST-B-01', name: 'TST-B-01', isActive: true }} sequence={1} legDistanceM={5}
        reachable active disabled={false} warehouseId={1} unlabelledTwins={[]}
        onActivate={() => {}} onDone={doneSpy}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Test Chilli Powder 200g/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Not this product?' }))
    fireEvent.change(screen.getByLabelText('What is really in the carton'), { target: { value: 'Goraka' } })
    fireEvent.click(screen.getByRole('option', { name: /Test Goraka 100g/ }))
    fireEvent.change(screen.getByLabelText('How many are there?'), { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record and hold' }))

    await waitFor(() => expect(reportMock).toHaveBeenCalledWith({
      recommendationId: 901, realProductId: 78, quantity: 70,
    }))
    await waitFor(() => expect(doneSpy).toHaveBeenCalled())
  })
})
