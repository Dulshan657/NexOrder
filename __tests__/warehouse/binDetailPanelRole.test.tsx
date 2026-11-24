// NX-0046 A5: Location detail offers the Warehouse role nothing the server refuses.
//
// `set_levels` and `convert_to_levels` are Admin/Manager only. The panel used to
// show the live level editor and "Split into levels" to everyone, so floor staff
// got controls that always ended in an error toast.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InventoryLocation, LayoutPlacement } from '@/types'
import { FALLBACK_LEVEL_ROLES } from '@/lib/levelRoles'

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))
vi.mock('@/hooks/useToasts', () => ({ useToastActions: () => ({ addToast: vi.fn() }) }))
vi.mock('@/hooks/queries/useLevelRoles', () => ({ useLevelRoles: () => ({ data: FALLBACK_LEVEL_ROLES }) }))
vi.mock('@/hooks/queries/useStorageTypes', () => ({ useStorageTypes: () => ({ data: [] }) }))

import { BinDetailPanel } from '@/components/inventory/warehouse/BinDetailPanel'

afterEach(() => cleanup())

const level = (i: number): InventoryLocation => ({
  id: 20 + i, kind: 'SHELF', code: `R1-L${i}`, name: `Rack 1 · L${i}`, parentId: 20,
  materializedPath: `/MAIN/R1/L${i}`, isActive: true, levelIndex: i, levelRole: 'pick', capacitySlots: 4,
}) as InventoryLocation
const levels = [level(1), level(2)]

const bin = {
  id: 30, kind: 'BIN', code: 'B-1', name: 'Bay 1', materializedPath: '/MAIN/B-1', isActive: true,
} as InventoryLocation
const placement = { id: 1, layoutId: 5, locationId: 30, floor: 0, x: 1, y: 1, w: 2, h: 1, rotation: 0 } as LayoutPlacement

function renderPanel(props: Partial<Parameters<typeof BinDetailPanel>[0]>) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BinDetailPanel
        warehouseId={1}
        location={levels[0]}
        contents={[]}
        fillPct={0}
        rackLevelLocations={levels}
        rackFillByLevel={new Map()}
        {...props}
      />
    </QueryClientProvider>,
  )
}

const editable = (root: Element) => root.querySelectorAll('select:not([disabled]), input:not([disabled])')

describe('BinDetailPanel', () => {
  it("shows the Warehouse role a rack's levels with nothing to change", () => {
    renderPanel({ canRename: false })
    const panel = screen.getByTestId('rack-level-panel')
    // The levels are still there to read and to select...
    expect(panel.textContent).toContain('R1-L1')
    expect(panel.textContent).toContain('R1-L2')
    // ...but nothing in the stack can be edited, added or removed.
    expect(editable(panel)).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Add level' })).toBeNull()
  })

  it('offers the Warehouse role no Split into levels', () => {
    renderPanel({ canRename: false, location: bin, placement, rackLevelLocations: [] })
    expect(screen.queryByTestId('split-into-levels-button')).toBeNull()
  })

  it('keeps both for someone who may change a rack', () => {
    const { unmount } = renderPanel({ canRename: true })
    expect(editable(screen.getByTestId('rack-level-panel')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Add level' })).toBeTruthy()
    unmount()
    renderPanel({ canRename: true, location: bin, placement, rackLevelLocations: [] })
    expect(screen.getByTestId('split-into-levels-button')).toBeTruthy()
  })
})
