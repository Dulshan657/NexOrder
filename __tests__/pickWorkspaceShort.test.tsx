// The pick workspace on an order imported from an invoice raised elsewhere.
//
// Stock on such an order can be short, missing, or more than the system shows, so
// the picker needs three things the ordinary order never gets: a way to finish a
// line with what was really found (including nothing), a way to pick from a bin
// the system does not know holds the item, and a packing gate that opens when
// every line is picked OR closed short.
//
// The backend is a small stateful fake: closing a line short on the "server"
// really changes what the next fetch returns, so the tests prove the screen
// refreshes from the server rather than trusting its own optimistic patch.
//
// Every name, SKU and bin code below is made up.

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { __resetModalStack } from '../components/ui/useModalStack'
import { __resetScrollLock } from '../components/ui/useScrollLock'

const ORDER_ID = 'ORD-TEST-1'

/**
 * A server refusal as the pick calls throw it: an Error that carries the function's
 * `reason`, `code` and `status`. Built here, not imported, so these tests describe
 * what the screen is handed rather than how the service happens to build it.
 */
function refusal(message: string, info: { reason: string | null; code: string; status: number }): Error {
  return Object.assign(new Error(message), info)
}

const svc = vi.hoisted(() => ({
  getPickQueue: vi.fn(),
  getOrderPickTasks: vi.fn(),
  recordPick: vi.fn(),
  recordShortPick: vi.fn(),
}))
const ui = vi.hoisted(() => ({
  addToast: vi.fn(),
  profile: { role: 'Manager', home_warehouse_id: null as number | null },
  locations: [] as unknown[],
}))

vi.mock('@/services/supabase/pickService', () => ({
  ...svc,
  generatePickSlip: vi.fn(),
  generateDispatchAdvice: vi.fn(),
}))
vi.mock('@/services/supabase/orderService', () => ({ updateOrderStatus: vi.fn() }))
vi.mock('@/services/supabase/locationNameService', () => ({
  getLocationNames: vi.fn(async () => new Map()),
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ profile: ui.profile }) }))
vi.mock('@/hooks/useToasts', () => ({ useToastActions: () => ({ addToast: ui.addToast }) }))
vi.mock('@/context/DocumentViewerContext', () => ({
  useDocumentViewer: () => ({ previewDocument: vi.fn() }),
}))
vi.mock('@/components/inventory/PickRoutePanel', () => ({ PickRoutePanel: () => null }))
vi.mock('@/hooks/queries/useInventoryBalances', () => ({
  useLocations: () => ({ data: ui.locations }),
}))

const { default: PickWorkspaceModal } = await import('../components/inventory/PickWorkspaceModal')

interface Line {
  orderItemId: number
  productId: number
  productName: string
  productSku: string
  productBarcode: string | null
  quantity: number
  picked: number
}

function line(over: Partial<Line> & { orderItemId: number }): Line {
  return {
    productId: over.orderItemId,
    productName: `Test Item ${over.orderItemId}`,
    productSku: `TST-${over.orderItemId}`,
    productBarcode: null, // no barcode: the SKU label is all there is to scan
    quantity: 5,
    picked: 0,
    ...over,
  }
}

interface Task {
  orderItemId: number
  productId: number
  warehouseId: number
  warehouseCode: string
  locationId: number
  code: string
  graphNodeId: number | null
  allocatedQty: number
  pickedQty: number
  remaining: number
  unreserved?: boolean
}

function task(over: Partial<Task> & { orderItemId: number; locationId: number }): Task {
  return {
    productId: over.orderItemId,
    warehouseId: 1,
    warehouseCode: 'TST-A',
    code: `TST-A-B${over.locationId}`,
    graphNodeId: null,
    allocatedQty: 3,
    pickedQty: 0,
    remaining: 3,
    ...over,
  }
}

const bin = (id: number, code: string, kind = 'BIN') => ({
  id, code, name: code, kind, materializedPath: `1/${id}`, isActive: true,
})

interface Backend {
  status: string
  lines: Line[]
  tasks: Task[]
  imported: boolean | undefined
  closed: number[]
  warehouses: number[]
}
let backend: Backend
let qc: QueryClient

function seed(over: Partial<Backend> = {}) {
  backend = {
    status: 'processed',
    lines: [line({ orderItemId: 1, quantity: 5, picked: 2 })],
    tasks: [task({ orderItemId: 1, locationId: 501 })],
    imported: true,
    closed: [],
    warehouses: [1],
    ...over,
  }
}

const found = (l: Line) => l.picked

beforeEach(() => {
  __resetModalStack()
  __resetScrollLock()
  const main = document.createElement('div')
  main.setAttribute('data-scroll-container', '')
  document.body.appendChild(main)

  ui.profile = { role: 'Manager', home_warehouse_id: null }
  ui.locations = [bin(88, 'TST-RACK-07'), bin(89, 'TST-RACK-08'), bin(70, 'TST-RACK', 'RACK')]
  ui.addToast.mockReset()
  for (const fn of Object.values(svc)) fn.mockReset()
  seed()

  svc.getPickQueue.mockImplementation(async () => [
    {
      orderId: ORDER_ID,
      status: backend.status,
      orderDate: null,
      deliveryDate: null,
      horecaName: 'Test Cafe',
      horecaAddress: '',
      fulfilmentWarehouseIds: backend.warehouses,
      lines: structuredClone(backend.lines),
    },
  ])
  svc.getOrderPickTasks.mockImplementation(async () => ({
    tasks: structuredClone(backend.tasks),
    // An older function knows no `imported`; the screen must treat that as "not imported".
    ...(backend.imported === undefined ? {} : { imported: backend.imported }),
    closedShortLineIds: [...backend.closed],
    foundByLine: Object.fromEntries(backend.lines.map((l) => [l.orderItemId, found(l)])),
  }))
  svc.recordShortPick.mockImplementation(async (orderItemId: number) => {
    backend.closed = [...backend.closed, orderItemId]
    return { status: 'closed', line_closed: true, order_fully_resolved: false }
  })
  svc.recordPick.mockImplementation(async () => ({ line_fully_picked: false, order_fully_picked: false }))

  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

async function openWorkspace() {
  render(
    <QueryClientProvider client={qc}>
      <PickWorkspaceModal orderId={ORDER_ID} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
  await screen.findByRole('dialog')
  // The tasks answer is what tells the screen whether the order is imported.
  await waitFor(() => expect(svc.getOrderPickTasks).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByText(/loading pick tasks/i)).toBeNull())
}

const finishShortTrigger = () => screen.queryByRole('button', { name: 'None found / finish short' })
const confirmPanel = () => screen.getByRole('group', { name: /finish this line short/i })
const markPacked = () => screen.queryByRole('button', { name: /mark packed/i })

function scan(label: RegExp, code: string) {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value: code } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('pick workspace short picks', () => {
  it('offers finish short on an open imported line, behind a confirm step', async () => {
    await openWorkspace()

    // Offered on the open line, and nothing has been posted by merely offering it.
    const trigger = await screen.findByRole('button', { name: 'None found / finish short' })
    expect(svc.recordShortPick).not.toHaveBeenCalled()

    // Opening it explains what will happen, found quantity included. Still nothing posted.
    fireEvent.click(trigger)
    const panel = confirmPanel()
    expect(within(panel).getByText(/found 2 of 5/i)).toBeTruthy()
    expect(within(panel).getByText(/recorded as a difference for the office/i)).toBeTruthy()
    expect(within(panel).getByText(/stock counts do not change/i)).toBeTruthy()
    expect(svc.recordShortPick).not.toHaveBeenCalled()

    // Only the confirm posts, naming the one bin the line points at.
    fireEvent.click(within(panel).getByRole('button', { name: 'Finish short' }))
    await waitFor(() => expect(svc.recordShortPick).toHaveBeenCalledTimes(1))
    expect(svc.recordShortPick).toHaveBeenCalledWith(1, 501)

    // The server now says the line is closed; the row shows what was found.
    expect(await screen.findByText('Short: found 2 of 5')).toBeTruthy()
    expect(finishShortTrigger()).toBeNull()
  })

  it('lets the picker back out of the confirm step without posting', async () => {
    await openWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: 'None found / finish short' }))
    fireEvent.click(within(confirmPanel()).getByRole('button', { name: 'Keep picking' }))

    expect(screen.queryByRole('group', { name: /finish this line short/i })).toBeNull()
    expect(finishShortTrigger()).not.toBeNull()
    expect(svc.recordShortPick).not.toHaveBeenCalled()
  })

  it('puts focus on the safe choice when the confirm opens, and back on the trigger when it closes', async () => {
    await openWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: 'None found / finish short' }))
    // A scanner's trailing Enter must not land on the button that finishes the line.
    expect(document.activeElement).toBe(within(confirmPanel()).getByRole('button', { name: 'Keep picking' }))

    fireEvent.click(within(confirmPanel()).getByRole('button', { name: 'Keep picking' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'None found / finish short' }))
  })

  it('never offers finish short on any other order', async () => {
    // The control case first: the same open line on an imported order offers it.
    await openWorkspace()
    expect(await screen.findByRole('button', { name: 'None found / finish short' })).toBeTruthy()
    cleanup()

    // An ordinary order, an older function that never says, and an explicit false.
    for (const imported of [false, undefined]) {
      seed({ imported })
      qc.clear()
      svc.getOrderPickTasks.mockClear()
      await openWorkspace()
      expect(screen.getByText('Test Item 1')).toBeTruthy()
      expect(finishShortTrigger()).toBeNull()
      expect(screen.queryByText(/scan a bin to pick/i)).toBeNull()
      cleanup()
    }
  })

  it('keeps the old "no bin" message, and no scan-any-bin, on an ordinary order with no tasks', async () => {
    seed({ imported: false, tasks: [] })
    await openWorkspace()

    expect(await screen.findByText(/no allocated bin for this line yet/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /scan a bin to pick/i })).toBeNull()
    expect(finishShortTrigger()).toBeNull()
  })

  it('unlocks packing when every line is picked or closed short', async () => {
    seed({
      status: 'picked',
      lines: [line({ orderItemId: 1, quantity: 5, picked: 5 }), line({ orderItemId: 2, quantity: 4, picked: 1 })],
      tasks: [],
      closed: [2],
    })
    await openWorkspace()

    expect(await screen.findByText('Short: found 1 of 4')).toBeTruthy()
    expect(markPacked()).not.toBeNull()
    expect(screen.queryByText(/to unlock packing/i)).toBeNull()
  })

  it('keeps packing locked while a line is open', async () => {
    seed({
      status: 'picked',
      lines: [line({ orderItemId: 1, quantity: 5, picked: 5 }), line({ orderItemId: 2, quantity: 4, picked: 1 })],
      tasks: [task({ orderItemId: 2, locationId: 502, remaining: 3 })],
      closed: [],
    })
    await openWorkspace()

    // One line picked, one still open: locked, and the open line is the one that offers a way out.
    expect(await screen.findByRole('button', { name: 'None found / finish short' })).toBeTruthy()
    expect(markPacked()).toBeNull()
    expect(screen.getByText(/to unlock packing/i)).toBeTruthy()
    expect(screen.queryByText(/^Short: found/)).toBeNull()
  })

  it('keeps packing locked when one line is closed short and another is still open', async () => {
    seed({
      status: 'picked',
      lines: [line({ orderItemId: 1, quantity: 5, picked: 2 }), line({ orderItemId: 2, quantity: 4, picked: 0 })],
      tasks: [task({ orderItemId: 2, locationId: 502, remaining: 4 })],
      closed: [1],
    })
    await openWorkspace()

    expect(await screen.findByText('Short: found 2 of 5')).toBeTruthy()
    expect(markPacked()).toBeNull()
    expect(screen.getByText(/to unlock packing/i)).toBeTruthy()
  })

  it('shows a closed line as closed: no scan, no finish short', async () => {
    seed({ lines: [line({ orderItemId: 1, quantity: 5, picked: 0 })], tasks: [], closed: [1] })
    await openWorkspace()

    expect(await screen.findByText('Short: found 0 of 5')).toBeTruthy()
    expect(finishShortTrigger()).toBeNull()
    expect(screen.queryByRole('button', { name: /scan/i })).toBeNull()
  })

  it('lets the picker scan any bin when no bin has recorded stock', async () => {
    seed({ lines: [line({ orderItemId: 1, quantity: 3, picked: 0 })], tasks: [] })
    await openWorkspace()

    // Said plainly before anything is scanned.
    expect(await screen.findByText(/the system shows no available stock of this item in any bin/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /scan a bin to pick/i }))

    // Any bin, then the item. The item is scanned by its SKU label: this product has no barcode.
    scan(/scan the bin you found it in/i, 'TST-RACK-07')
    expect(await screen.findByText(/shows no available stock of this item at TST-RACK-07/i)).toBeTruthy()
    scan(/scan the item/i, 'TST-1')

    fireEvent.click(await screen.findByRole('button', { name: /confirm pick/i }))

    await waitFor(() => expect(svc.recordPick).toHaveBeenCalledTimes(1))
    // The bin's own location id, found by resolving the scanned code, plus the evidence the server re-checks.
    expect(svc.recordPick).toHaveBeenCalledWith(1, 3, 88, { locationCode: 'TST-RACK-07', productCode: 'TST-1' })
  })

  it('refuses a scanned code that is not a place stock sits, and an unknown one', async () => {
    seed({ lines: [line({ orderItemId: 1, quantity: 3, picked: 0 })], tasks: [] })
    await openWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: /scan a bin to pick/i }))

    scan(/scan the bin you found it in/i, 'NOPE-123')
    expect(await screen.findByText(/no bin matches NOPE-123/i)).toBeTruthy()

    scan(/scan the bin you found it in/i, 'TST-RACK')
    expect(await screen.findByText(/not a place stock sits/i)).toBeTruthy()
    expect(screen.queryByLabelText(/scan the item/i)).toBeNull()
    expect(svc.recordPick).not.toHaveBeenCalled()
  })

  it('refuses the wrong item at an unlisted bin before posting anything', async () => {
    seed({ lines: [line({ orderItemId: 1, quantity: 3, picked: 0 })], tasks: [] })
    await openWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: /scan a bin to pick/i }))
    scan(/scan the bin you found it in/i, 'TST-RACK-07')
    await screen.findByLabelText(/scan the item/i)
    scan(/scan the item/i, 'TST-999')

    expect(await screen.findByText(/that item is not TST-1/i)).toBeTruthy()
    expect(svc.recordPick).not.toHaveBeenCalled()
  })

  it('offers an unreserved bin as a pick, marked as not reserved for this order', async () => {
    seed({
      lines: [line({ orderItemId: 1, quantity: 5, picked: 2 })],
      tasks: [task({ orderItemId: 1, locationId: 503, remaining: 3, unreserved: true })],
    })
    await openWorkspace()

    expect(await screen.findByText(/not reserved for this order/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /scan to pick 3/i })).toBeTruthy()
  })

  it('posts finish short with no bin when the line points at more than one', async () => {
    seed({
      tasks: [task({ orderItemId: 1, locationId: 501 }), task({ orderItemId: 1, locationId: 502 })],
    })
    await openWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: 'None found / finish short' }))
    fireEvent.click(within(confirmPanel()).getByRole('button', { name: 'Finish short' }))

    await waitFor(() => expect(svc.recordShortPick).toHaveBeenCalledTimes(1))
    expect(svc.recordShortPick).toHaveBeenCalledWith(1, undefined)
  })

  it('posts finish short with no bin when the line has no bin at all', async () => {
    seed({ lines: [line({ orderItemId: 1, quantity: 3, picked: 0 })], tasks: [] })
    await openWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: 'None found / finish short' }))
    fireEvent.click(within(confirmPanel()).getByRole('button', { name: 'Finish short' }))

    await waitFor(() => expect(svc.recordShortPick).toHaveBeenCalledWith(1, undefined))
  })

  it('names the bin that will be flagged for a recount when it knows one', async () => {
    await openWorkspace()
    fireEvent.click(await screen.findByRole('button', { name: 'None found / finish short' }))
    expect(within(confirmPanel()).getByText(/TST-A-B501/)).toBeTruthy()
    expect(within(confirmPanel()).getByText(/recount/i)).toBeTruthy()
  })

  it('refreshes what a pick refreshes after a successful finish short', async () => {
    await openWorkspace()
    const queueBefore = svc.getPickQueue.mock.calls.length
    const tasksBefore = svc.getOrderPickTasks.mock.calls.length

    fireEvent.click(await screen.findByRole('button', { name: 'None found / finish short' }))
    fireEvent.click(within(confirmPanel()).getByRole('button', { name: 'Finish short' }))

    await waitFor(() => expect(svc.getPickQueue.mock.calls.length).toBeGreaterThan(queueBefore))
    await waitFor(() => expect(svc.getOrderPickTasks.mock.calls.length).toBeGreaterThan(tasksBefore))
    await waitFor(() => expect(ui.addToast).toHaveBeenCalledWith(expect.stringMatching(/finished short/i), 'success'))
  })

  describe('edge cases', () => {
    it('posts once when the confirm is tapped twice', async () => {
      let release!: (v: unknown) => void
      svc.recordShortPick.mockImplementation(() => new Promise((res) => { release = res }))
      await openWorkspace()
      fireEvent.click(await screen.findByRole('button', { name: 'None found / finish short' }))

      const confirm = within(confirmPanel()).getByRole('button', { name: 'Finish short' })
      // Three taps inside one act(): React cannot re-render the button as disabled between
      // them, which is what two fast taps on a phone look like. Only a synchronous guard
      // stops the second and third.
      act(() => {
        confirm.click()
        confirm.click()
        confirm.click()
      })

      await waitFor(() => expect(svc.recordShortPick).toHaveBeenCalledTimes(1))
      // And while it is in flight the button says so and cannot be pressed.
      const busy = await within(confirmPanel()).findByRole('button', { name: /finishing/i })
      expect((busy as HTMLButtonElement).disabled).toBe(true)
      expect((within(confirmPanel()).getByRole('button', { name: 'Keep picking' }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(busy)

      await act(async () => { release({ status: 'closed' }) })
      expect(svc.recordShortPick).toHaveBeenCalledTimes(1)
    })

    it('posts a pick once when Confirm pick is tapped twice', async () => {
      let release!: (v: unknown) => void
      svc.recordPick.mockImplementation(() => new Promise((res) => { release = res }))
      seed({ lines: [line({ orderItemId: 1, quantity: 3, picked: 0 })], tasks: [] })
      await openWorkspace()
      fireEvent.click(await screen.findByRole('button', { name: /scan a bin to pick/i }))
      scan(/scan the bin you found it in/i, 'TST-RACK-07')
      await screen.findByLabelText(/scan the item/i)
      scan(/scan the item/i, 'TST-1')
      const confirm = await screen.findByRole('button', { name: /confirm pick/i })

      act(() => {
        confirm.click()
        confirm.click()
      })

      await waitFor(() => expect(svc.recordPick).toHaveBeenCalledTimes(1))
      await act(async () => { release({ line_fully_picked: true, order_fully_picked: false }) })
      expect(svc.recordPick).toHaveBeenCalledTimes(1)
    })

    it('shows a Warehouse user why their finish short was refused, and keeps the confirm open', async () => {
      ui.profile = { role: 'Warehouse', home_warehouse_id: 1 }
      svc.recordShortPick.mockRejectedValue(
        refusal('Another warehouse still holds stock for this line. Ask them to pick it, or ask a manager to finish the line short.', {
          reason: 'HELD_AT_OTHER_WAREHOUSE', code: 'CONFLICT', status: 409,
        }),
      )
      await openWorkspace()
      fireEvent.click(await screen.findByRole('button', { name: 'None found / finish short' }))
      fireEvent.click(within(confirmPanel()).getByRole('button', { name: 'Finish short' }))

      const alert = await within(confirmPanel()).findByRole('alert')
      expect(alert.textContent).toMatch(/another warehouse still holds stock for this line/i)
      expect(alert.textContent).toMatch(/ask a manager to finish the line short/i)
      // Not closed, not toasted as a success; the picker can read it and choose.
      expect(ui.addToast).not.toHaveBeenCalledWith(expect.anything(), 'success')
      expect(within(confirmPanel()).getByRole('button', { name: 'Finish short' })).toBeTruthy()
      expect(screen.queryByText(/^Short: found/)).toBeNull()
    })

    it.each([
      ['ORDER_CANCELLED', /this order was cancelled/i],
      ['BAD_LOCATION', /not in a warehouse that is picking this order/i],
      ['NOT_YOUR_WAREHOUSE', /only .* at your own warehouse/i],
    ])('shows %s in plain words on a refused finish short', async (reason, words) => {
      svc.recordShortPick.mockRejectedValue(refusal('server text', { reason, code: 'CONFLICT', status: 409 }))
      await openWorkspace()
      fireEvent.click(await screen.findByRole('button', { name: 'None found / finish short' }))
      fireEvent.click(within(confirmPanel()).getByRole('button', { name: 'Finish short' }))

      expect((await within(confirmPanel()).findByRole('alert')).textContent).toMatch(words)
    })

    it.each([
      ['LINE_CLOSED_SHORT', /already finished short/i],
      ['ORDER_CANCELLED', /this order was cancelled/i],
      ['BAD_LOCATION', /not in a warehouse that is picking this order/i],
    ])('shows %s in the row on a refused pick, keeping what was scanned', async (reason, words) => {
      svc.recordPick.mockRejectedValue(refusal('server text', { reason, code: 'CONFLICT', status: 409 }))
      seed({ lines: [line({ orderItemId: 1, quantity: 3, picked: 0 })], tasks: [] })
      await openWorkspace()
      fireEvent.click(await screen.findByRole('button', { name: /scan a bin to pick/i }))
      scan(/scan the bin you found it in/i, 'TST-RACK-07')
      await screen.findByLabelText(/scan the item/i)
      scan(/scan the item/i, 'TST-1')
      const qty = (await screen.findByLabelText('Quantity picked')) as HTMLInputElement
      fireEvent.change(qty, { target: { value: '2' } })
      fireEvent.click(screen.getByRole('button', { name: /confirm pick/i }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toMatch(words)
      // Still on the count step, with the bin, the item and the count exactly as entered.
      expect((screen.getByLabelText('Quantity picked') as HTMLInputElement).value).toBe('2')
      expect(screen.getByText('TST-RACK-07')).toBeTruthy()
      // The SKU is on the line header and on the item chip.
      expect(screen.getAllByText('TST-1').length).toBeGreaterThanOrEqual(2)
    })

    it('shows a refused directed pick in plain words instead of the transport error', async () => {
      svc.recordPick.mockRejectedValue(refusal('server text', { reason: 'LINE_CLOSED_SHORT', code: 'CONFLICT', status: 409 }))
      seed({ tasks: [task({ orderItemId: 1, locationId: 501, remaining: 3 })] })
      await openWorkspace()
      fireEvent.click(await screen.findByRole('button', { name: /scan to pick 3/i }))
      scan(/scan the bin/i, 'TST-A-B501')
      await screen.findByLabelText(/scan the item/i)
      scan(/scan the item/i, 'tst-1') // a label scanned in lower case still matches
      fireEvent.click(await screen.findByRole('button', { name: /confirm pick/i }))

      expect((await screen.findByRole('alert')).textContent).toMatch(/already finished short/i)
    })

    it('uses the server\'s own words for a refusal it has no wording for', async () => {
      svc.recordShortPick.mockRejectedValue(refusal('Rate limit exceeded: slow down', { reason: null, code: 'TOO_MANY_REQUESTS', status: 429 }))
      await openWorkspace()
      fireEvent.click(await screen.findByRole('button', { name: 'None found / finish short' }))
      fireEvent.click(within(confirmPanel()).getByRole('button', { name: 'Finish short' }))

      expect((await within(confirmPanel()).findByRole('alert')).textContent).toMatch(/rate limit exceeded/i)
    })
  })

  describe('touch targets and layout', () => {
    it('gives every new control the 44px floor', async () => {
      seed({ lines: [line({ orderItemId: 1, quantity: 3, picked: 0 })], tasks: [] })
      await openWorkspace()
      const classes = (el: HTMLElement) => el.className

      const finish = await screen.findByRole('button', { name: 'None found / finish short' })
      const anyBin = screen.getByRole('button', { name: /scan a bin to pick/i })
      for (const el of [finish, anyBin]) expect(classes(el)).toMatch(/touch-target-y|min-h-\[44px\]/)

      fireEvent.click(finish)
      for (const name of ['Finish short', 'Keep picking']) {
        expect(classes(within(confirmPanel()).getByRole('button', { name }))).toMatch(/min-h-\[44px\]/)
      }
    })
  })
})
