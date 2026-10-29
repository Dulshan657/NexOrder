// The dialog that moves an order to the status stored as 'processed' must say
// "confirm", the word the status is shown as (NX-0008). It said "Process Order"
// and "Confirm & Process", so the word the owner misread as "shipped" was still
// on screen at the very moment the status was set.

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Order } from '@/types'

vi.mock('@/hooks/queries/useWarehouses', () => ({ useWarehouses: () => ({ data: [] }) }))
vi.mock('../hooks/queries/useWarehouses', () => ({ useWarehouses: () => ({ data: [] }) }))

const { default: StockAssignmentModal } = await import('@/components/StockAssignmentModal')

afterEach(cleanup)

const order = {
  id: 'ORD-7',
  hoReCa: { id: 1, name: 'Harbour Cafe' },
  items: [],
  total: 10,
  orderDate: '2026-10-20T00:00:00.000Z',
  submittedBy: { id: 1, name: 'Rep' },
  status: 'processing',
  statusHistory: [],
} as unknown as Order

describe('StockAssignmentModal wording', () => {
  it('says confirm, never process, and writes a Confirmed note', () => {
    const onConfirm = vi.fn()
    render(React.createElement(StockAssignmentModal, { order, onConfirm, onCancel: vi.fn() }))

    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent ?? '').not.toMatch(/process/i)
    expect(screen.getByRole('heading', { name: 'Confirm Order ORD-7' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm order' }))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ note: expect.stringMatching(/^Confirmed — /) }))
  })
})
