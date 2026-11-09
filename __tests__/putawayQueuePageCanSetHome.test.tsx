// NX-0033: only a Manager or Admin is offered "give it a home" on the Walk. The
// server refuses everyone else (complete-putaway), so this is about not showing a
// Warehouse user an action that cannot work. The page decides from the signed-in
// role and hands the Walk a plain boolean.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const { walkProps } = vi.hoisted(() => ({ walkProps: vi.fn() }))

vi.mock('@/hooks/queries/useWarehouses', () => ({
  useWarehouses: () => ({ data: [{ id: 1, name: 'TST-WALK Warehouse', code: 'TST-WALK-WH', isActive: true }] }),
}))
vi.mock('@/hooks/queries/usePendingPutawayCounts', () => ({
  usePendingPutawayCounts: () => ({ data: { 1: 0 } }),
}))
vi.mock('@/hooks/queries/usePutawayWalk', () => ({
  useWalkPutaways: () => ({ data: [] }),
}))
vi.mock('@/context/WarehouseScopeContext', () => ({
  useWarehouseScope: () => ({ scope: 1, setScope: vi.fn() }),
}))
vi.mock('@/components/inventory/PutawayQueueView', () => ({ default: () => null }))
vi.mock('@/components/inventory/PutawayWalkView', () => ({
  default: (props: unknown) => { walkProps(props); return null },
}))

import PutawayQueuePage from '@/components/inventory/PutawayQueuePage'
import { UserRole, type User } from '@/types'

function user(role: UserRole): User {
  return { id: 'u1', name: 'TST-WALK User', role, homeWarehouseId: 1 } as unknown as User
}

describe('PutawayQueuePage — who is offered "give it a home"', () => {
  beforeEach(() => {
    walkProps.mockReset()
    // jsdom has no matchMedia; a narrow screen opens on the Walk tab.
    window.matchMedia = ((query: string) => ({
      matches: true, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  })
  afterEach(cleanup)

  it.each([
    [UserRole.ADMIN, true],
    [UserRole.MANAGER, true],
    [UserRole.WAREHOUSE, false],
  ])('%s -> canSetHome %s', (role, expected) => {
    render(<PutawayQueuePage currentUser={user(role)} />)
    expect(walkProps).toHaveBeenCalled()
    expect(walkProps.mock.calls.at(-1)?.[0]).toMatchObject({ warehouseId: 1, canSetHome: expected })
  })
})
