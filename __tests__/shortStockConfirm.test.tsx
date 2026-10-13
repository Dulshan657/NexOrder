import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ShortStockConfirm, { shortStockCopy } from '@/components/qr/ShortStockConfirm'
import { useShortStockGuard } from '@/hooks/useShortStockGuard'
import { __resetModalStack } from '@/components/ui/useModalStack'
import { __resetScrollLock } from '@/components/ui/useScrollLock'
import type { OrderItem, Product } from '@/types'
import { mkCartItem, mkProduct } from './fixtures'
import { expectNoA11yViolations } from './support/axe'

// The soft low-stock warning a kitchen (QR Staff) gets at submit. It names the
// items that may be short and NEVER says how many there are in stock.

beforeEach(() => {
  __resetModalStack()
  __resetScrollLock()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const noodles = mkProduct({ id: 1, name: 'Rice Noodles', available: 10 })
const oil = mkProduct({ id: 2, sku: 'SKU-2', name: 'Chilli Oil', available: 5 })
const sauce = mkProduct({ id: 3, sku: 'SKU-3', name: 'Soy Sauce', available: 1 })

/** The words with every product name taken out: what is left must hold no stock figure. */
const withoutNames = (text: string, names: string[]) =>
  names.reduce((rest, name) => rest.split(name).join(''), text)

describe('shortStockCopy', () => {
  it('names one item and says the manager will adjust it', () => {
    const copy = shortStockCopy(['Rice Noodles 200g'])
    expect(copy.title).toBe('Some items may be short')
    expect(copy.message).toBe('Rice Noodles 200g may be short. Send anyway — your manager will adjust it.')
  })

  it('lists several items', () => {
    expect(shortStockCopy(['Rice Noodles', 'Chilli Oil']).message).toBe(
      'These items may be short: Rice Noodles, Chilli Oil. Send anyway — your manager will adjust them.',
    )
  })

  it('carries no digit of its own, so it cannot state a quantity', () => {
    for (const names of [['Rice Noodles'], ['Rice Noodles', 'Chilli Oil', 'Soy Sauce']]) {
      const { title, message } = shortStockCopy(names)
      expect(withoutNames(`${title} ${message}`, names)).not.toMatch(/\d/)
    }
  })
})

describe('<ShortStockConfirm>', () => {
  const mount = (names: string[]) => {
    const onSendAnyway = vi.fn()
    const onChangeOrder = vi.fn()
    render(<ShortStockConfirm names={names} onSendAnyway={onSendAnyway} onChangeOrder={onChangeOrder} />)
    return { onSendAnyway, onChangeOrder }
  }

  it('is an alert dialog naming the items, with both choices', () => {
    mount(['Rice Noodles'])
    const dialog = screen.getByRole('alertdialog', { name: 'Some items may be short' })
    expect(within(dialog).getByText(/Rice Noodles may be short/)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Send anyway' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Change order' })).toBeTruthy()
  })

  it('"Send anyway" sends, and only that', () => {
    const { onSendAnyway, onChangeOrder } = mount(['Rice Noodles'])
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }))
    expect(onSendAnyway).toHaveBeenCalledTimes(1)
    expect(onChangeOrder).not.toHaveBeenCalled()
  })

  it('"Change order" goes back, and sends nothing', () => {
    const { onSendAnyway, onChangeOrder } = mount(['Rice Noodles'])
    fireEvent.click(screen.getByRole('button', { name: 'Change order' }))
    expect(onChangeOrder).toHaveBeenCalledTimes(1)
    expect(onSendAnyway).not.toHaveBeenCalled()
  })

  it('shows no digit beyond what the product names carry', () => {
    mount(['Rice Noodles', 'Chilli Oil'])
    const dialog = screen.getByRole('alertdialog')
    expect(withoutNames(dialog.textContent ?? '', ['Rice Noodles', 'Chilli Oil'])).not.toMatch(/\d/)
  })

  it('has no WCAG 2.2 AA violations', async () => {
    mount(['Rice Noodles', 'Chilli Oil'])
    await expectNoA11yViolations(screen.getByRole('alertdialog'))
  })
})

describe('useShortStockGuard', () => {
  function Harness(props: {
    enabled: boolean
    items: OrderItem[]
    products?: Product[]
    submit: () => void
  }) {
    const { guard, dialog } = useShortStockGuard({
      enabled: props.enabled,
      products: props.products ?? [noodles, oil, sauce],
    })
    return (
      <>
        <button type="button" onClick={() => guard(props.items, props.submit)}>
          Submit
        </button>
        {dialog}
      </>
    )
  }

  const click = () => fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

  it('submits straight away when every item is in stock', () => {
    const submit = vi.fn()
    render(<Harness enabled items={[mkCartItem(noodles, 3), mkCartItem(oil, 5)]} submit={submit} />)
    click()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('holds the submit and names the short item', () => {
    const submit = vi.fn()
    render(<Harness enabled items={[mkCartItem(noodles, 11), mkCartItem(oil, 1)]} submit={submit} />)
    click()
    expect(submit).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/Rice Noodles may be short/)).toBeTruthy()
    expect(within(dialog).queryByText(/Chilli Oil/)).toBeNull()
  })

  it('names every short item', () => {
    render(<Harness enabled items={[mkCartItem(noodles, 11), mkCartItem(sauce, 2)]} submit={vi.fn()} />)
    click()
    expect(screen.getByRole('alertdialog').textContent).toContain('Rice Noodles, Soy Sauce')
  })

  it('"Send anyway" submits once and closes the dialog', () => {
    const submit = vi.fn()
    render(<Harness enabled items={[mkCartItem(noodles, 11)]} submit={submit} />)
    click()
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('"Change order" closes the dialog and submits nothing', () => {
    const submit = vi.fn()
    render(<Harness enabled items={[mkCartItem(noodles, 11)]} submit={submit} />)
    click()
    fireEvent.click(screen.getByRole('button', { name: 'Change order' }))
    expect(submit).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('Escape is "Change order", never "Send anyway"', () => {
    const submit = vi.fn()
    render(<Harness enabled items={[mkCartItem(noodles, 11)]} submit={submit} />)
    click()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(submit).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks again on the next submit', () => {
    const submit = vi.fn()
    render(<Harness enabled items={[mkCartItem(noodles, 11)]} submit={submit} />)
    click()
    fireEvent.click(screen.getByRole('button', { name: 'Change order' }))
    click()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })

  it('never interferes when it is not enabled (Customer, reps, admins)', () => {
    const submit = vi.fn()
    render(<Harness enabled={false} items={[mkCartItem(noodles, 11)]} submit={submit} />)
    click()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('lets an empty order through to the checks that refuse it', () => {
    const submit = vi.fn()
    render(<Harness enabled items={[]} submit={submit} />)
    click()
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('shows no stock figure in the dialog', () => {
    render(<Harness enabled items={[mkCartItem(noodles, 11), mkCartItem(oil, 6)]} submit={vi.fn()} />)
    click()
    const text = screen.getByRole('alertdialog').textContent ?? ''
    expect(withoutNames(text, ['Rice Noodles', 'Chilli Oil'])).not.toMatch(/\d/)
  })
})
