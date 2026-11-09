// NX-0033: the Walk lists a loose overflow line (its home was full) as a stop
// to CONFIRM, at the bin the engine suggested, and the Assign queue marks the
// same line. Either list can confirm it; the first wins.
//
// The stop's own behaviour (scan to confirm, the refusal text) belongs to the
// stop card and is tested with the card. This file pins what the LIST shows: the
// stop is there, it sits at its suggested bin (it has no assigned bin yet), it
// says it needs a decision, and a plain assigned stop does not say so.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { tasksMock, routeMock, locationsMock, zoneProfilesMock } = vi.hoisted(() => ({
  tasksMock: vi.fn(),
  routeMock: vi.fn(),
  locationsMock: vi.fn(),
  zoneProfilesMock: vi.fn(),
}))

vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useWalkPutaways: () => tasksMock(),
  usePutawayRoute: () => routeMock(),
  useCompletePutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnassignPutaway: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmOverflow: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/queries/useWarehouseLocations', () => ({
  useWarehouseLocations: () => locationsMock(),
}))
// Which bins are held (I1) comes from the zone profiles; none are, unless a case says so.
vi.mock('@/hooks/queries/useZoneProfiles', () => ({
  useZoneProfiles: () => zoneProfilesMock(),
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

import PutawayWalkView from '@/components/inventory/PutawayWalkView'
import { PutawayRow } from '@/components/inventory/putaway/PutawayRow'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { Product } from '@/types'

const WAREHOUSE_ID = 2873
const OVERFLOW_BIN = 'TST-WALK-O1'
const HOME_BIN = 'TST-WALK-H1'

/** A loose line, no plate and no product barcode, so a stop opens straight on the bin. */
function line(over: Partial<PendingPutawayRow> = {}): PendingPutawayRow {
  return {
    id: 901,
    productId: 77,
    quantity: 24,
    recommendedLocationId: 5002,
    explanation: {
      engineVersion: 'v1', layoutId: 1, candidatesConsidered: 3,
      hardFilters: [], winner: null, alternatives: [],
    },
    createdAt: '2026-11-09T00:00:00Z',
    product: { id: 77, name: 'TST-WALK Product 100', sku: 'TST-WALK-100', barcode: null } as Product,
    receipt: null,
    huId: null,
    huType: null,
    huCode: null,
    huLabelPrinted: null,
    huStatus: null,
    status: 'suggested',
    assignedLocationId: null,
    assignedAt: null,
    suggestionSource: 'overflow',
    ...over,
  }
}

/** Awaiting confirmation: suggested, overflow, a suggested bin, no assigned bin. */
const CONFIRM_STOP = line()
/** An ordinary stop: assigned to the product's home bin. */
const ASSIGNED_STOP = line({
  id: 902, status: 'assigned', suggestionSource: 'home',
  recommendedLocationId: 5001, assignedLocationId: 5001, assignedAt: '2026-11-09T00:01:00Z',
})

const LOCATIONS = [
  { id: 5001, code: HOME_BIN, name: HOME_BIN, isActive: true },
  { id: 5002, code: OVERFLOW_BIN, name: OVERFLOW_BIN, isActive: true },
]

/** The walk, routed by the engine: each stop's live bin code comes from the route. */
function mountRouted(rows: PendingPutawayRow[], codes: Array<{ id: number; code: string }> = []) {
  tasksMock.mockReturnValue({ data: rows, isLoading: false, isError: false })
  routeMock.mockReturnValue({
    data: {
      mode: 'engine',
      unreachableCount: 0,
      totalDistanceM: 20,
      stops: codes.map((s, i) => ({
        recId: s.id, sequence: i + 1, legDistanceM: 10, reachable: true, code: s.code,
      })),
    },
    isLoading: false,
    isError: false,
  })
  locationsMock.mockReturnValue({ data: LOCATIONS, isLoading: false, isError: false })
  return render(<PutawayWalkView warehouseId={WAREHOUSE_ID} />)
}

/** A site with no published layout: no route, so bins come from the cached list. */
function mountLegacy(rows: PendingPutawayRow[]) {
  tasksMock.mockReturnValue({ data: rows, isLoading: false, isError: false })
  routeMock.mockReturnValue({ data: { mode: 'legacy' }, isLoading: false, isError: false })
  locationsMock.mockReturnValue({ data: LOCATIONS, isLoading: false, isError: false })
  return render(<PutawayWalkView warehouseId={WAREHOUSE_ID} />)
}

afterEach(cleanup)
beforeEach(() => {
  zoneProfilesMock.mockReturnValue({ data: [], isLoading: false, isError: false })
})

describe('PutawayWalkView — overflow lines awaiting confirmation', () => {
  it('lists an overflow line awaiting confirmation at its suggested bin', () => {
    mountRouted([CONFIRM_STOP], [{ id: 901, code: OVERFLOW_BIN }])
    expect(screen.getByText(OVERFLOW_BIN)).toBeTruthy()
    expect(screen.getByText('Home full — confirm')).toBeTruthy()
  })

  it('finds the suggested bin in the bin list when there is no route', () => {
    // The line has no assigned bin yet, so the bin is looked up by the SUGGESTED id.
    mountLegacy([CONFIRM_STOP])
    expect(screen.getByText(OVERFLOW_BIN)).toBeTruthy()
    expect(screen.getByText('Home full — confirm')).toBeTruthy()
  })

  it('does not mark a single-product pallet, which never waits for confirmation', () => {
    mountRouted([line({ unitLoad: true })], [{ id: 901, code: OVERFLOW_BIN }])
    expect(screen.getByText(OVERFLOW_BIN)).toBeTruthy()
    expect(screen.queryByText('Home full — confirm')).toBeNull()
  })

  it('does not mark a plain assigned stop', () => {
    mountRouted([ASSIGNED_STOP], [{ id: 902, code: HOME_BIN }])
    expect(screen.getByText(HOME_BIN)).toBeTruthy()
    expect(screen.queryByText('Home full — confirm')).toBeNull()
  })

  it('marks only the stop that needs confirming when both kinds are listed', () => {
    mountRouted([ASSIGNED_STOP, CONFIRM_STOP], [
      { id: 902, code: HOME_BIN },
      { id: 901, code: OVERFLOW_BIN },
    ])
    expect(screen.getAllByText('Home full — confirm')).toHaveLength(1)
  })

  it('finds the stop when its suggested bin is scanned', () => {
    // The scan finder looks lines up by the bin they are destined for; for a
    // confirm stop that is the suggested bin, not the (empty) assigned one.
    mountLegacy([CONFIRM_STOP])
    const finder = screen.getByLabelText(/plate, carton or bin/i)
    fireEvent.change(finder, { target: { value: OVERFLOW_BIN } })
    fireEvent.keyDown(finder, { key: 'Enter' })
    // A single match makes that stop the one being worked, and the walk then
    // withdraws the queue-level finder (one live scan input at a time). A scan
    // that matched nothing would leave it where it was.
    expect(screen.queryByLabelText(/plate, carton or bin/i)).toBeNull()
    expect(screen.getByRole('button', { name: /TST-WALK Product 100/ })).toBeTruthy()
  })

  it('does not find the stop by a bin it is not at', () => {
    mountLegacy([CONFIRM_STOP])
    const finder = screen.getByLabelText(/plate, carton or bin/i)
    fireEvent.change(finder, { target: { value: HOME_BIN } })
    fireEvent.keyDown(finder, { key: 'Enter' })
    expect(screen.getByLabelText(/plate, carton or bin/i)).toBeTruthy()
  })

  it('tells an empty walk where the lines that need a decision are', () => {
    mountRouted([])
    expect(screen.getByText('Nothing to carry')).toBeTruthy()
    expect(
      screen.getByText('Received lines show up here. Lines that need a decision wait on the Assign tab.'),
    ).toBeTruthy()
  })
})

// The Walk hands each stop card the role-derived `canSetHome`. The card's own
// tests mount the card directly with the prop, and the page test mounts a mocked
// Walk, so this is the one place the wiring between them is proved: without it a
// dropped prop would leave the give-a-home offer dead for managers and nothing red.
describe('PutawayWalkView — the give-a-home offer reaches the stop card', () => {
  const OFFER = 'This product has no home bin. Give it one?'

  /** A line for a product that has no home: assigned to an engine bin. */
  const NO_HOME_STOP = line({
    id: 903, status: 'assigned', suggestionSource: 'engine',
    recommendedLocationId: 5001, assignedLocationId: 5001, assignedAt: '2026-11-09T00:01:00Z',
    homeLocationId: null,
  })

  function mountWalk(rows: PendingPutawayRow[], canSetHome?: boolean) {
    tasksMock.mockReturnValue({ data: rows, isLoading: false, isError: false })
    routeMock.mockReturnValue({ data: { mode: 'legacy' }, isLoading: false, isError: false })
    locationsMock.mockReturnValue({ data: LOCATIONS, isLoading: false, isError: false })
    return render(<PutawayWalkView warehouseId={WAREHOUSE_ID} canSetHome={canSetHome} />)
  }

  const openStop = () => fireEvent.click(screen.getByRole('button', { name: /TST-WALK Product 100/ }))

  it('offers a Manager or Admin the chance to give the product a home', () => {
    mountWalk([NO_HOME_STOP], true)
    openStop()
    expect(screen.getByText(OFFER)).toBeTruthy()
  })

  it('offers a Warehouse user nothing', () => {
    mountWalk([NO_HOME_STOP], false)
    openStop()
    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('offers nothing by default, when the page does not say the user may', () => {
    mountWalk([NO_HOME_STOP])
    openStop()
    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('offers nothing on a stop at a hold bin: a held line never makes a home (I1)', () => {
    zoneProfilesMock.mockReturnValue({
      data: [{ id: 41, name: 'TST-WALK hold', isHold: true }], isLoading: false, isError: false,
    })
    tasksMock.mockReturnValue({ data: [NO_HOME_STOP], isLoading: false, isError: false })
    routeMock.mockReturnValue({ data: { mode: 'legacy' }, isLoading: false, isError: false })
    locationsMock.mockReturnValue({
      data: [
        { id: 4100, kind: 'ZONE', code: 'TST-WALK-QZ', name: 'TST-WALK-QZ', isActive: true,
          materializedPath: 'TSTWALKWH/TST-WALK-QZ', zoneProfileId: 41 },
        { id: 5001, kind: 'BIN', code: HOME_BIN, name: HOME_BIN, isActive: true,
          materializedPath: `TSTWALKWH/TST-WALK-QZ/${HOME_BIN}` },
      ],
      isLoading: false,
      isError: false,
    })
    render(<PutawayWalkView warehouseId={WAREHOUSE_ID} canSetHome />)
    openStop()
    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('offers nothing until it knows whether the stop is at a hold bin', () => {
    zoneProfilesMock.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    mountWalk([NO_HOME_STOP], true)
    openStop()
    expect(screen.queryByText(OFFER)).toBeNull()
  })

  it('offers nothing for a product that already has a home', () => {
    mountWalk([{ ...NO_HOME_STOP, homeLocationId: 6001 }], true)
    openStop()
    expect(screen.queryByText(OFFER)).toBeNull()
  })
})

describe('PutawayRow — the Assign queue', () => {
  function renderRow(row: PendingPutawayRow) {
    return render(
      <PutawayRow
        row={row}
        bin={{ code: OVERFLOW_BIN, name: OVERFLOW_BIN, isActive: true }}
        expanded={false}
        busy={false}
        onToggleExplanation={() => {}}
        onAssign={() => {}}
        onPlaceNow={() => {}}
        onChooseBin={() => {}}
        onRerun={() => {}}
      />,
    )
  }

  it('marks an overflow line Home full', () => {
    renderRow(CONFIRM_STOP)
    expect(screen.getByText('Home full')).toBeTruthy()
  })

  it('does not mark an overflow line with no bin to confirm (M5)', () => {
    // A residual nothing could hold: not on the Walk, so not "Home full — confirm".
    renderRow(line({ recommendedLocationId: null }))
    expect(screen.queryByText('Home full')).toBeNull()
  })

  it('does not mark a single-product pallet: it stays an ordinary queue line', () => {
    renderRow(line({ unitLoad: true }))
    expect(screen.queryByText('Home full')).toBeNull()
  })

  it('does not mark a line that was suggested for any other reason', () => {
    for (const suggestionSource of ['home', 'engine', 'desk', null] as const) {
      renderRow(line({ suggestionSource }))
      expect(screen.queryByText('Home full')).toBeNull()
      cleanup()
    }
  })
})
