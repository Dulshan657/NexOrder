// NX-0007 — after a receipt, "Put away now" opens Putaway on just that
// delivery (?receipt=), and the existing no-scan Accept panel stays.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/components/inventory/receive/ReceiptPlateLabels', () => ({
  ReceiptPlateLabels: () => null,
}))
vi.mock('@/components/inventory/PutawayPanel', () => ({
  PutawayPanel: () => <div>accept panel</div>,
}))

import { ReceiveSuccessCard } from '@/components/inventory/receive/ReceiveSuccessCard'

afterEach(cleanup)

describe('ReceiveSuccessCard', () => {
  it('Put away now opens putaway filtered to the receipt', () => {
    const onOpenPutaway = vi.fn()
    render(
      <ReceiveSuccessCard
        summary={{
          receiptId: 42,
          linesReceived: 1,
          units: '5 carton',
          destName: 'Main',
          warehouseId: 1,
          recommendations: [{
            recommendationId: 1, productId: 3, quantity: 5, recommendedLocationId: 537,
            alternatives: [], explanation: {} as never,
          }],
        }}
        productNameById={new Map([[3, 'Coconut Milk 400ml']])}
        onOpenPutaway={onOpenPutaway}
        onStartNext={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Put away now/i }))
    expect(onOpenPutaway).toHaveBeenCalledWith(1, 42)

    // The desk's no-scan path is still offered.
    fireEvent.click(screen.getByRole('button', { name: /Suggested locations/i }))
    expect(screen.getByText('accept panel')).toBeTruthy()
  })
})
