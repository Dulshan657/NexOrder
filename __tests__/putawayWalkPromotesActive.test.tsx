// ── THE BUG THIS FILE EXISTS TO PREVENT ─────────────────────────────────────
//
// The walk hoists the stop being worked to the top of the list, because at
// 360x664 an expanded card rendered in route order starts below the fold — and
// on the RS35 a scan only reaches the FOCUSED editable, so an off-screen scan
// field means a scan that silently does nothing.
//
// The obvious way to build that is broken. `PutawayStopCard` keeps the whole
// wizard in local state (`step`, the accepted codes, the scanned bin, the
// count), and `start()` sets `step` in the same commit that calls `onActivate`.
// React reconciles keyed children WITHIN A PARENT, so:
//
//   - reordering the array         -> the DOM node MOVES, the instance survives;
//   - rendering the active card
//     from a different JSX element -> a different child slot, so React UNMOUNTS
//                                     it. `step` resets to 'idle', the card
//                                     renders its collapsed button again, and
//                                     tapping a stop does nothing. Forever.
//
// The second shape looks entirely reasonable in review — `{active && <Now/>}`
// above `{rest.map(...)}` — and nothing else in the suite would catch it:
// `putawayIdentifyByProduct` renders PutawayStopCard directly, and
// `putawayInvalidation` mounts the queue, not the walk. So this file mounts the
// WALK and opens a stop that is not first, which is precisely the case that
// distinguishes the two implementations.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { tasksMock, routeMock, locationsMock } = vi.hoisted(() => ({
  tasksMock: vi.fn(),
  routeMock: vi.fn(),
  locationsMock: vi.fn(),
}))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useAssignedPutaways: () => tasksMock(),
  usePutawayRoute: () => routeMock(),
  useCompletePutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  useWarehouseLocations: () => locationsMock(),
}))
vi.mock('@/hooks/queries/usePalletBreakdown', () => ({
  usePrintPlateLabels: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePlanBreakdown: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBreakDownPallet: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/useToasts', () => ({ useToasts: () => ({ addToast: vi.fn() }) }))

import PutawayWalkView from '@/components/inventory/PutawayWalkView'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

const WAREHOUSE_ID = 2873

/** Four stops. Every plate is labelled and every product carries a barcode, so
 *  `putawayIdentity` asks to identify first — which is what puts a scan field on
 *  the card the moment it opens. */
function stop(n: number): PendingPutawayRow {
  return {
    id: 500 + n,
    productId: 50 + n,
    quantity: 12,
    recommendedLocationId: 3000 + n,
    explanation: {
      engineVersion: 'v1', layoutId: 1, candidatesConsidered: 3,
      hardFilters: [], winner: null, alternatives: [],
    },
    createdAt: '2026-08-27T00:52:43Z',
    product: {
      id: 50 + n, name: `Product ${n}`, sku: `SKU-${n}`, barcode: `47960098688${n}0`,
    } as Product,
    receipt: null,
    huId: 270 + n,
    huType: 'carton',
    huCode: `HU-00050${n}`,
    huLabelPrinted: true,
    huStatus: 'stored',
    assignedLocationId: 3000 + n,
    assignedAt: '2026-08-27T01:01:45Z',
  }
}

const TASKS = [stop(1), stop(2), stop(3), stop(4)]

function mount() {
  tasksMock.mockReturnValue({ data: TASKS, isLoading: false, isError: false })
  routeMock.mockReturnValue({
    data: {
      mode: 'engine',
      unreachableCount: 0,
      totalDistanceM: 40,
      stops: TASKS.map((t, i) => ({
        recId: t.id,
        sequence: i + 1,
        legDistanceM: 10,
        reachable: true,
        code: `BIN-${i + 1}`,
      })),
    },
    isLoading: false,
    isError: false,
  })
  locationsMock.mockReturnValue({ data: [], isLoading: false, isError: false })
  return render(<PutawayWalkView warehouseId={WAREHOUSE_ID} />)
}

/** The collapsed rows, in the order they are painted. */
function rowButtons(): HTMLElement[] {
  return screen
    .getAllByRole('button')
    .filter((b) => /Product \d/.test(b.textContent ?? ''))
}

afterEach(cleanup)

describe('putaway walk — the open stop is hoisted, not remounted', () => {
  it('opens a stop that is not first and keeps its scan field mounted', () => {
    mount()

    // The THIRD stop, deliberately. Opening the first would pass under either
    // implementation, since a card already at index 0 never changes slot.
    const third = rowButtons()[2]
    expect(third.textContent).toContain('Product 3')
    fireEvent.click(third)

    // Under the broken shape the card unmounts, `step` falls back to 'idle' and
    // this is a collapsed button again — so there is no scan field and no
    // progress rail, only four collapsed rows as before the click.
    expect(screen.getByLabelText('Putaway progress')).toBeTruthy()
    expect(screen.getByText('Take it to')).toBeTruthy()
    expect(screen.getByLabelText(/Scan/i)).toBeTruthy()
  })

  it('moves the open stop to the top without renumbering the route', () => {
    mount()
    fireEvent.click(rowButtons()[2])

    // The promoted card is expanded, so it is no longer one of the collapsed
    // rows: what remains reads 1, 2, 4 — a gap where the open stop was, never a
    // resequence. `sequence` comes from the server, never from array position.
    const remaining = rowButtons().map((b) => b.textContent ?? '')
    expect(remaining).toHaveLength(3)
    expect(remaining[0]).toContain('Product 1')
    expect(remaining[1]).toContain('Product 2')
    expect(remaining[2]).toContain('Product 4')
  })

  it('withholds the queue-level scan finder while a stop is open', () => {
    mount()
    // Two live scan inputs on one screen is a coin toss over which hears the
    // gun, because an Android IME types into the focused editable and nowhere
    // else. With nothing open, the finder is the one scan target.
    expect(screen.getByLabelText(/plate, carton or bin/i)).toBeTruthy()

    fireEvent.click(rowButtons()[2])
    expect(screen.queryByLabelText(/plate, carton or bin/i)).toBeNull()
  })
})
