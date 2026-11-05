import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import PromotionAdmin from '../components/PromotionAdmin'
import PromotionForm from '../components/PromotionForm'
import { fromPromotion } from '../lib/adapters'
import type { Promotion } from '../types'

afterEach(cleanup)

const scheduled: Promotion = {
  id: 'PROMO-001',
  name: 'Winter deal',
  description: '',
  type: 'percentage',
  percentOff: 10,
  scope: { kind: 'storewide' },
  targeting: { kind: 'all' },
  stackWithHoReCaPricing: true,
  startDate: '2099-01-01',
  endDate: '2099-02-01',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  createdBy: 1,
  priority: 10,
} as Promotion

const renderForm = (onSave: (promo: Promotion) => Promise<void>, onClose = vi.fn(), promotion?: Promotion) => {
  render(<PromotionForm promotion={promotion} products={[]} hoReCas={[]} users={[]} onSave={onSave} onClose={onClose} />)
  return onClose
}

const nameBox = () => screen.getByPlaceholderText(/e\.g\. S/)

const renderAdmin = () => {
  const onUpdate = vi.fn(async (_promo: Partial<Promotion>) => {})
  const onDelete = vi.fn()
  render(
    <PromotionAdmin
      promotions={[scheduled]}
      products={[]}
      hoReCas={[]}
      users={[]}
      onAdd={vi.fn(async () => {})}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />,
  )
  return { onUpdate, onDelete }
}

describe('PromotionAdmin', () => {
  it('delete does nothing until confirmed', () => {
    const { onDelete } = renderAdmin()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Winter deal' }))
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Winter deal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith('PROMO-001')
  })

  it('the toggle sends only is_active', () => {
    const { onUpdate } = renderAdmin()

    fireEvent.click(screen.getByTitle('Deactivate'))
    expect(onUpdate).toHaveBeenCalledWith({ id: 'PROMO-001', isActive: false })
    expect(fromPromotion(onUpdate.mock.calls[0][0])).toEqual({ is_active: false })
  })
})

describe('PromotionForm', () => {
  it('refuses an empty discount with its reason, and sends nothing', () => {
    const onSave = vi.fn(async () => {})
    renderForm(onSave)

    fireEvent.change(nameBox(), { target: { value: 'No discount' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Promotion' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/discount/i)
  })

  it('stays open and shows the reason when the server refuses', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('This promotion has already been applied to confirmed orders')
    })
    const onClose = renderForm(onSave, vi.fn(), scheduled)

    fireEvent.click(screen.getByRole('button', { name: 'Update Promotion' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/already been applied/))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Update Promotion' })).toBeTruthy()
  })

  it('clearing an end date on an edit sends null', async () => {
    const onSave = vi.fn(async (_promo: Promotion) => {})
    renderForm(onSave, vi.fn(), scheduled)

    const dates = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dates[1], { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update Promotion' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const sent = onSave.mock.calls[0][0]
    expect(sent.endDate).toBeNull()
    expect(sent.startDate).toBe('2099-01-01')
    // And it survives the adapter, which leaves undefined out of the update.
    expect(fromPromotion(sent).end_date).toBeNull()
  })

  it('cannot be cancelled while a save is in flight', async () => {
    let finish: () => void = () => {}
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const onClose = renderForm(onSave, vi.fn(), scheduled)

    fireEvent.click(screen.getByRole('button', { name: 'Update Promotion' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())

    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    fireEvent.click(cancel)
    expect(onClose).not.toHaveBeenCalled()
    finish()
  })
})
