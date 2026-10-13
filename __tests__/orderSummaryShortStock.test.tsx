import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import OrderSummary from '@/components/OrderSummary'
import { __resetModalStack } from '@/components/ui/useModalStack'
import { __resetScrollLock } from '@/components/ui/useScrollLock'
import { UserRole } from '@/types'
import type { OrderItem } from '@/types'
import { mkCartItem, mkHoReCa, mkProduct, mkUser } from './fixtures'
import { expectNoA11yViolations } from './support/axe'

// The cart's Submit button. For a kitchen (QR Staff) an order that may be short is
// held behind a soft warning that names the items -- never how many are in stock.
// Everyone else's Submit is exactly what it was.

beforeEach(() => {
  __resetModalStack()
  __resetScrollLock()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const noodles = mkProduct({ id: 1, name: 'Rice Noodles', price: 4, available: 10 })
const oil = mkProduct({ id: 2, sku: 'SKU-2', name: 'Chilli Oil', price: 10, available: 5 })
const venue = mkHoReCa({ id: 10, name: 'Harbour Bistro' })
const kitchen = mkUser({ id: 7, name: 'Sam', role: UserRole.QR_STAFF, hoReCaId: 10 })
const customer = mkUser({ id: 8, name: 'Dee', role: UserRole.CUSTOMER, hoReCaId: 10 })
const rep = mkUser({ id: 9, name: 'Rex', role: UserRole.FIELD_REP })
const admin = mkUser({ id: 1, name: 'Ada', role: UserRole.ADMIN })

function mount(user: typeof kitchen, items: OrderItem[]) {
  const onSubmitOrder = vi.fn()
  render(
    <OrderSummary
      items={items}
      total={items.reduce((s, i) => s + i.price * i.quantity, 0)}
      currentUser={user}
      userRole={user.role}
      hoReCas={[venue]}
      selectedHoReCaId={10}
      notes=""
      deliveryDate=""
      deliveryTimeSlot=""
      onSelectHoReCa={vi.fn()}
      onUpdateQuantity={vi.fn()}
      onSubmitOrder={onSubmitOrder}
      onNotesChange={vi.fn()}
      onDeliveryDateChange={vi.fn()}
      onDeliveryTimeSlotChange={vi.fn()}
      isLoading={false}
      errors={{}}
      products={[noodles, oil]}
    />,
  )
  return { onSubmitOrder }
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }))
const shortCart = () => [mkCartItem(noodles, 11), mkCartItem(oil, 1)]
const fullCart = () => [mkCartItem(noodles, 3), mkCartItem(oil, 5)]

describe('OrderSummary — Submit for a kitchen (QR Staff)', () => {
  it('submits straight away when everything is in stock', () => {
    const { onSubmitOrder } = mount(kitchen, fullCart())
    submit()
    expect(onSubmitOrder).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('holds the submit behind a warning that names the short item', () => {
    const { onSubmitOrder } = mount(kitchen, shortCart())
    submit()

    const dialog = screen.getByRole('alertdialog', { name: 'Some items may be short' })
    expect(within(dialog).getByText('Rice Noodles may be short. Send anyway — your manager will adjust it.')).toBeTruthy()
    expect(onSubmitOrder).not.toHaveBeenCalled()
  })

  it('names every short item', () => {
    const { onSubmitOrder } = mount(kitchen, [mkCartItem(noodles, 11), mkCartItem(oil, 6)])
    submit()
    expect(screen.getByRole('alertdialog').textContent).toContain(
      'These items may be short: Rice Noodles, Chilli Oil. Send anyway — your manager will adjust them.',
    )
    expect(onSubmitOrder).not.toHaveBeenCalled()
  })

  it('"Send anyway" submits exactly once and closes the warning', () => {
    const { onSubmitOrder } = mount(kitchen, shortCart())
    submit()
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }))
    expect(onSubmitOrder).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('"Change order" submits nothing and closes the warning', () => {
    const { onSubmitOrder } = mount(kitchen, shortCart())
    submit()
    fireEvent.click(screen.getByRole('button', { name: 'Change order' }))
    expect(onSubmitOrder).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('judges a carton line in base units', () => {
    // 2 cartons of 6 = 12 units against 10.
    const { onSubmitOrder } = mount(kitchen, [mkCartItem(noodles, 2, 6)])
    submit()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(onSubmitOrder).not.toHaveBeenCalled()
  })

  it('shows no stock figure: no digit beyond the product names', () => {
    mount(kitchen, [mkCartItem(noodles, 11), mkCartItem(oil, 6)])
    submit()
    const text = screen.getByRole('alertdialog').textContent ?? ''
    expect(text.split('Rice Noodles').join('').split('Chilli Oil').join('')).not.toMatch(/\d/)
  })

  it('has no WCAG 2.2 AA violations in the warning', async () => {
    mount(kitchen, shortCart())
    submit()
    await expectNoA11yViolations(screen.getByRole('alertdialog'))
  })
})

describe('OrderSummary — Submit for everyone else is unchanged', () => {
  it.each([
    ['a Customer', customer],
    ['a Field Sales Rep', rep],
    ['an Admin', admin],
  ])('%s submits a short cart straight through, with no warning', (_who, user) => {
    const { onSubmitOrder } = mount(user, shortCart())
    submit()
    expect(onSubmitOrder).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
