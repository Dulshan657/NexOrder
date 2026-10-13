import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { QrApiError } from '@/lib/qr/qrApiError'
import { UserRole } from '@/types'
import type { Order, OrderItem, Product } from '@/types'
import { mkCartItem, mkHoReCa, mkProduct, mkUser } from './fixtures'
import { expectNoA11yViolations } from './support/axe'

const submitQrRequest = vi.fn()
vi.mock('@/services/supabase/qrService', () => ({
  submitQrRequest: (...a: unknown[]) => submitQrRequest(...a),
  cancelQrRequest: vi.fn(),
  listQrRequests: vi.fn(),
  previewQrRequest: vi.fn(),
  approveQrRequest: vi.fn(),
  rejectQrRequest: vi.fn(),
}))
vi.mock('@/lib/qr/qrSessionEnd', () => ({ handleQrSessionEnded: vi.fn() }))

// The pending banner is C2's component and has its own tests; here only that the
// right side of the counter is asked for.
vi.mock('@/components/qr/PendingQrRequests', () => ({
  default: (p: { mode: string; horecaId?: number; compact?: boolean }) => (
    <div data-testid="pending" data-mode={p.mode} data-horeca={p.horecaId} data-compact={String(p.compact)} />
  ),
}))

const { default: KitchenHomeView } = await import('@/views/KitchenHomeView')
const { OrderProvider, useOrderContext } = await import('@/context/OrderContext')

const tomato = mkProduct({ id: 1, name: 'Tomato Paste', price: 4, available: 50 })
const chilli = mkProduct({ id: 2, sku: 'SKU-2', name: 'Chilli Oil', price: 10, available: 20 })
const products: Product[] = [tomato, chilli]
const venue = mkHoReCa({ id: 10, name: 'Harbour Bistro' })
const kitchen = mkUser({ id: 7, name: 'Sam Lee', role: UserRole.QR_STAFF, hoReCaId: 10 })
const customer = mkUser({ id: 8, name: 'Dee', role: UserRole.CUSTOMER, hoReCaId: 10 })

const mkOrder = (id: string, day: number, items: OrderItem[], over: Partial<Order> = {}): Order => ({
  id,
  hoReCa: venue,
  items,
  total: items.reduce((s, i) => s + i.price * i.quantity, 0),
  orderDate: `2026-10-${String(day).padStart(2, '0')}T08:00:00Z`,
  submittedBy: customer,
  status: 'delivered',
  statusHistory: [],
  ...over,
})

const lastOrder = mkOrder('ORD-3', 10, [mkCartItem(tomato, 3), mkCartItem(chilli, 1)])
const olderOrders = [mkOrder('ORD-2', 8, [mkCartItem(tomato, 1)]), mkOrder('ORD-1', 6, [mkCartItem(chilli, 2)])]
const orders = [lastOrder, ...olderOrders]

const baseProps = () => ({
  currentUser: kitchen,
  products,
  hoReCa: venue,
  orders,
  promotions: [],
  cartonDiscountPercent: 5,
  pantryCount: 0,
  onOrderNow: vi.fn().mockResolvedValue({ ok: true }),
  onEditItems: vi.fn(),
  onOpenShop: vi.fn(),
  onOpenPantry: vi.fn(),
  onOpenHistory: vi.fn(),
  onViewOrder: vi.fn(),
  addToast: vi.fn(),
})

beforeEach(() => {
  submitQrRequest.mockReset().mockResolvedValue({ requestId: 'r1', quotedTotal: 22, status: 'pending', createdAt: 'x' })
})
afterEach(cleanup)

describe('KitchenHomeView — the screen', () => {
  it('names the venue, greets kitchen staff by first name, and asks for their own pending requests', () => {
    render(<KitchenHomeView {...baseProps()} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Harbour Bistro' })).toBeTruthy()
    expect(screen.getByText('Hi Sam')).toBeTruthy()
    const pending = screen.getByTestId('pending')
    expect(pending.getAttribute('data-mode')).toBe('requester')
    expect(pending.getAttribute('data-horeca')).toBe('10')
  })

  it('does not greet a Customer, and shows them the approver side of the pending list', () => {
    render(<KitchenHomeView {...baseProps()} currentUser={customer} />)
    expect(screen.queryByText(/^Hi /)).toBeNull()
    expect(screen.getByTestId('pending').getAttribute('data-mode')).toBe('approver')
  })

  it('shows the last order with its date, size, status and today\'s estimate', () => {
    render(<KitchenHomeView {...baseProps()} />)
    const hero = screen.getByRole('region', { name: 'Your last order' })
    expect(within(hero).getByText('2 items · $22.00')).toBeTruthy()
    expect(within(hero).getByText('Delivered')).toBeTruthy()
    expect(within(hero).getByText(/Tomato Paste, Chilli Oil/)).toBeTruthy()
    // 3 x $4 + 1 x $10, today's prices, and labelled as an estimate.
    expect(within(hero).getByText('$22.00', { selector: 'span' })).toBeTruthy()
    expect(within(hero).getByText(/\(estimate\)/)).toBeTruthy()
  })

  it('offers the newest order that was not cancelled', () => {
    const cancelled = mkOrder('ORD-4', 11, [mkCartItem(chilli, 9)], { status: 'cancelled' })
    render(<KitchenHomeView {...baseProps()} orders={[cancelled, ...orders]} />)
    const hero = screen.getByRole('region', { name: 'Your last order' })
    expect(within(hero).getByText(/Tomato Paste/)).toBeTruthy()
    expect(within(hero).queryByText('Cancelled')).toBeNull()
  })

  it('lists the last three orders, each with a status and a Reorder button', () => {
    const four = [mkOrder('ORD-0', 2, [mkCartItem(tomato, 1)]), ...orders]
    render(<KitchenHomeView {...baseProps()} orders={four} />)
    const recent = screen.getByRole('region', { name: 'Recent orders' })
    expect(within(recent).getAllByRole('listitem')).toHaveLength(3)
    expect(within(recent).getAllByRole('button', { name: /^Reorder the order from/ })).toHaveLength(3)
    expect(within(recent).queryByText(/Fri, 2 Oct/)).toBeNull()
  })

  it('shows a friendly empty state with a way into the Shop when nothing was ordered yet', () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} orders={[]} />)
    expect(screen.getByRole('heading', { name: 'No orders yet' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Order same again' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Browse shop' }))
    expect(props.onOpenShop).toHaveBeenCalledTimes(1)
  })

  it('only counts this venue\'s orders', () => {
    const elsewhere = { ...lastOrder, id: 'X-1', hoReCa: mkHoReCa({ id: 99 }) }
    render(<KitchenHomeView {...baseProps()} orders={[elsewhere]} />)
    expect(screen.getByRole('heading', { name: 'No orders yet' })).toBeTruthy()
  })

  it('wires the shortcuts and the order list', () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} pantryCount={4} />)
    fireEvent.click(screen.getByRole('button', { name: 'Shop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pantry list (4)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Order history' }))
    fireEvent.click(screen.getAllByRole('button', { name: /^View order from/ })[0])
    expect(props.onOpenShop).toHaveBeenCalledTimes(1)
    expect(props.onOpenPantry).toHaveBeenCalledTimes(1)
    expect(props.onOpenHistory).toHaveBeenCalledTimes(1)
    expect(props.onViewOrder).toHaveBeenCalledWith('ORD-3')
  })

  it('waits quietly while the venue is still loading', () => {
    render(<KitchenHomeView {...baseProps()} hoReCa={undefined} />)
    expect(screen.getByRole('status').textContent).toMatch(/loading/i)
  })

  it('has no WCAG 2.2 AA violations', async () => {
    const { container } = render(<KitchenHomeView {...baseProps()} />)
    await expectNoA11yViolations(container)
  })
})

describe('KitchenHomeView — Edit before ordering', () => {
  it('hands the hero order\'s lines, at today\'s prices, to the cart', () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit before ordering' }))

    expect(props.onEditItems).toHaveBeenCalledTimes(1)
    const items = props.onEditItems.mock.calls[0][0] as OrderItem[]
    expect(items.map((i) => [i.id, i.quantity, i.price])).toEqual([
      [1, 3, 4],
      [2, 1, 10],
    ])
    expect(props.onOrderNow).not.toHaveBeenCalled()
  })

  it('reorders a recent order through the same path', () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} />)
    const recent = screen.getByRole('region', { name: 'Recent orders' })
    fireEvent.click(within(recent).getAllByRole('button', { name: /^Reorder the order from/ })[2])
    const items = props.onEditItems.mock.calls[0][0] as OrderItem[]
    expect(items.map((i) => [i.id, i.quantity])).toEqual([[2, 2]]) // ORD-1
  })

  it('leaves out what cannot be ordered today and says so', () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} products={[tomato, { ...chilli, available: 0 }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit before ordering' }))
    expect((props.onEditItems.mock.calls[0][0] as OrderItem[]).map((i) => i.id)).toEqual([1])
    expect(props.addToast).toHaveBeenCalledWith('Left out: Chilli Oil', 'info')
  })

  it('does not load an empty cart', () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} products={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit before ordering' }))
    expect(props.onEditItems).not.toHaveBeenCalled()
    expect(props.addToast).toHaveBeenCalledWith('None of the items from that order can be ordered right now.', 'error')
  })
})

describe('KitchenHomeView — Order same again', () => {
  it('opens a confirm step for kitchen staff that says it goes for approval and lists the lines', () => {
    render(<KitchenHomeView {...baseProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/goes to your manager for approval first/i)).toBeTruthy()
    expect(within(dialog).getByText('Tomato Paste')).toBeTruthy()
    expect(within(dialog).getByText('Chilli Oil')).toBeTruthy()
    expect(within(dialog).getByText('Estimated total')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Send for approval' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Place order' })).toBeNull()
  })

  it('says "Place order", and nothing about approval, to a Customer', () => {
    render(<KitchenHomeView {...baseProps()} currentUser={customer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Place order' })).toBeTruthy()
    expect(within(dialog).queryByText(/approval/i)).toBeNull()
  })

  it('flags an out-of-stock line, excludes it, and sends only the rest', async () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} products={[tomato, { ...chilli, available: 0 }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Chilli Oil — Out of stock/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send for approval' }))

    await waitFor(() => expect(props.onOrderNow).toHaveBeenCalledTimes(1))
    expect((props.onOrderNow.mock.calls[0][0] as OrderItem[]).map((i) => i.id)).toEqual([1])
  })

  it('flags a line asking for more than is in stock, to a Customer, with the count', () => {
    render(<KitchenHomeView {...baseProps()} currentUser={customer} products={[{ ...tomato, available: 2 }, chilli]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))
    expect(within(screen.getByRole('dialog')).getByText('Only 2 in stock')).toBeTruthy()
  })

  it('flags the same line to kitchen staff WITHOUT saying how many are in stock', () => {
    render(<KitchenHomeView {...baseProps()} products={[{ ...tomato, available: 2 }, chilli]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('May be short — your manager will adjust it')).toBeTruthy()
    expect(within(dialog).queryByText(/in stock/i)).toBeNull()
  })

  it('passes the optional note and closes on success', async () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/note for your supplier/i), { target: { value: ' leave at the back ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send for approval' }))

    await waitFor(() => expect(props.onOrderNow).toHaveBeenCalled())
    expect(props.onOrderNow.mock.calls[0][1]).toEqual({ notes: 'leave at the back' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('stays open and shows why when the submit fails', async () => {
    const props = baseProps()
    props.onOrderNow.mockResolvedValue({ ok: false, error: 'Chilli Oil is no longer available.' })
    render(<KitchenHomeView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send for approval' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Chilli Oil is no longer available.')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('can move on to editing from the confirm step', () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Edit before ordering' }))
    expect(props.onEditItems).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('has no WCAG 2.2 AA violations in the confirm step', async () => {
    render(<KitchenHomeView {...baseProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))
    await expectNoA11yViolations(screen.getByRole('dialog'))
  })
})

// A kitchen that is about to send an order that may be short is told so first --
// by NAME, never by how many are in stock -- and can still send it anyway.
describe('KitchenHomeView — Order same again, an order that may be short', () => {
  // Last order is 3 Tomato Paste + 1 Chilli Oil: with 2 Tomato Paste available it is short.
  const shortProducts = [{ ...tomato, available: 2 }, chilli]

  const openAndSend = (label: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }))
  }

  it('asks first, naming the item and holding the submit', () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} products={shortProducts} />)
    openAndSend('Send for approval')

    const warning = screen.getByRole('alertdialog', { name: 'Some items may be short' })
    expect(within(warning).getByText(/Tomato Paste may be short/)).toBeTruthy()
    expect(within(warning).queryByText(/Chilli Oil/)).toBeNull()
    expect(props.onOrderNow).not.toHaveBeenCalled()
  })

  it('shows no stock figure in the warning', () => {
    render(<KitchenHomeView {...baseProps()} products={shortProducts} />)
    openAndSend('Send for approval')
    const text = screen.getByRole('alertdialog').textContent ?? ''
    expect(text.split('Tomato Paste').join('')).not.toMatch(/\d/)
  })

  it('"Send anyway" files the request once, with the note, and closes everything', async () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} products={shortProducts} />)
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(/note for your supplier/i), {
      target: { value: 'back door' },
    })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send for approval' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Send anyway' }))

    await waitFor(() => expect(props.onOrderNow).toHaveBeenCalledTimes(1))
    expect((props.onOrderNow.mock.calls[0][0] as OrderItem[]).map((i) => [i.id, i.quantity])).toEqual([
      [1, 3],
      [2, 1],
    ])
    expect(props.onOrderNow.mock.calls[0][1]).toEqual({ notes: 'back door' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('"Change order" sends nothing and leaves the order open to change', () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} products={shortProducts} />)
    openAndSend('Send for approval')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change order' }))

    expect(props.onOrderNow).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // Still on the same-again step, where "Edit before ordering" is one tap away.
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send for approval' })).toBeTruthy()
  })

  it('does not ask when everything asked for is in stock', async () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} />)
    openAndSend('Send for approval')
    await waitFor(() => expect(props.onOrderNow).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('does not ask about a line it is leaving out (nothing is sent for it)', async () => {
    const props = baseProps()
    // Chilli Oil has none: it is left out, and Tomato Paste is in stock.
    render(<KitchenHomeView {...props} products={[tomato, { ...chilli, available: 0 }]} />)
    openAndSend('Send for approval')
    await waitFor(() => expect(props.onOrderNow).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('never asks a Customer: their order is real and the server is the check', async () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} currentUser={customer} products={shortProducts} />)
    openAndSend('Place order')
    await waitFor(() => expect(props.onOrderNow).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('does not ask when the person chooses to edit instead', () => {
    const props = baseProps()
    render(<KitchenHomeView {...props} products={shortProducts} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit before ordering' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(props.onEditItems).toHaveBeenCalledTimes(1)
  })

  it('has no WCAG 2.2 AA violations in the warning', async () => {
    render(<KitchenHomeView {...baseProps()} products={shortProducts} />)
    openAndSend('Send for approval')
    await expectNoA11yViolations(screen.getByRole('alertdialog'))
  })
})

// The real thing end to end: the view wired to the real OrderProvider, so what
// "Order same again" does is decided by the login's role and nothing else.
describe('KitchenHomeView + OrderProvider — who orders how', () => {
  const SETTINGS = { orderIdPrefix: 'ORD', minimumOrderValue: 0, cartonDiscountPercent: 5 }

  function Bridge(props: ReturnType<typeof baseProps>) {
    const { orderItemsNow } = useOrderContext()
    return <KitchenHomeView {...props} onOrderNow={orderItemsNow} />
  }

  function mount(currentUser: typeof kitchen, placeMutate = vi.fn(), catalogue: Product[] = products) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const onQrSubmitted = vi.fn()
    const props = { ...baseProps(), currentUser, products: catalogue }
    render(
      <QueryClientProvider client={qc}>
        <OrderProvider
          {...({
            currentUser,
            products: catalogue,
            hoReCas: [venue],
            promotions: [],
            invoices: [],
            appSettings: SETTINGS,
            addToast: props.addToast,
            placeOrderMutation: { mutate: placeMutate },
            onQrSubmitted,
          } as unknown as Parameters<typeof OrderProvider>[0])}
        >
          <Bridge {...props} />
        </OrderProvider>
      </QueryClientProvider>,
    )
    return { onQrSubmitted, placeMutate }
  }

  const confirm = (label: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Order same again' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }))
  }

  it('QR Staff: files a request for approval and never calls place-order', async () => {
    const { onQrSubmitted, placeMutate } = mount(kitchen)
    confirm('Send for approval')

    await waitFor(() => expect(submitQrRequest).toHaveBeenCalledTimes(1))
    expect(submitQrRequest.mock.calls[0][0].items).toEqual([
      { productId: 1, quantity: 3, packSize: null, uomId: null },
      { productId: 2, quantity: 1, packSize: null, uomId: null },
    ])
    expect(placeMutate).not.toHaveBeenCalled()
    await waitFor(() => expect(onQrSubmitted).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Customer: places the order through the existing path and files nothing', async () => {
    const placeMutate = vi.fn((_v: unknown, opts: { onSuccess: (r: { orderId: string; total: number }) => void }) =>
      opts.onSuccess({ orderId: 'ORD-9', total: 22 }),
    )
    mount(customer, placeMutate)
    confirm('Place order')

    await waitFor(() => expect(placeMutate).toHaveBeenCalledTimes(1))
    expect(placeMutate.mock.calls[0][0]).toMatchObject({
      hoReCaId: 10,
      items: [
        { productId: 1, quantity: 3 },
        { productId: 2, quantity: 1 },
      ],
    })
    expect(submitQrRequest).not.toHaveBeenCalled()
  })

  const shortCatalogue = [{ ...tomato, available: 2 }, chilli]

  it('QR Staff, order may be short: nothing is filed until "Send anyway", then exactly one request', async () => {
    const { onQrSubmitted, placeMutate } = mount(kitchen, vi.fn(), shortCatalogue)
    confirm('Send for approval')

    expect(screen.getByRole('alertdialog', { name: 'Some items may be short' })).toBeTruthy()
    expect(submitQrRequest).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Send anyway' }))
    await waitFor(() => expect(submitQrRequest).toHaveBeenCalledTimes(1))
    expect(submitQrRequest.mock.calls[0][0].items).toEqual([
      { productId: 1, quantity: 3, packSize: null, uomId: null },
      { productId: 2, quantity: 1, packSize: null, uomId: null },
    ])
    expect(placeMutate).not.toHaveBeenCalled()
    await waitFor(() => expect(onQrSubmitted).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('QR Staff, order may be short: "Change order" files nothing', () => {
    mount(kitchen, vi.fn(), shortCatalogue)
    confirm('Send for approval')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change order' }))
    expect(submitQrRequest).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('Customer, order may be short: places it with no warning (their path is unchanged)', async () => {
    const placeMutate = vi.fn((_v: unknown, opts: { onSuccess: (r: { orderId: string; total: number }) => void }) =>
      opts.onSuccess({ orderId: 'ORD-9', total: 22 }),
    )
    mount(customer, placeMutate, shortCatalogue)
    confirm('Place order')
    await waitFor(() => expect(placeMutate).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('QR Staff: shows the reason and keeps the dialog when the server refuses', async () => {
    submitQrRequest.mockRejectedValue(new QrApiError({ code: 'PRODUCT_NOT_FOUND', message: 'Tomato Paste is gone.' }))
    mount(kitchen)
    confirm('Send for approval')
    expect((await screen.findByRole('alert')).textContent).toBe('Tomato Paste is gone.')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
