// NX-0039 A13: the Locations panel stays open; the groups in its tree start collapsed.

import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { InventoryLocation } from '@/types'
import type { LocationTreeNode } from '@/components/inventory/warehouse/useWarehouseViewerModel'
import { WarehouseTreePanel } from '@/components/inventory/warehouse/WarehouseTreePanel'

afterEach(() => cleanup())
// jsdom has no layout, so no scrollIntoView; the tree calls it on selection.
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn() })

const loc = (id: number, kind: InventoryLocation['kind'], code: string, name: string) =>
  ({ id, kind, code, name, parentId: null, isActive: true }) as unknown as InventoryLocation

const tree: LocationTreeNode[] = [
  {
    location: loc(2, 'ZONE', 'Z1', 'Chiller'),
    children: [{
      location: loc(3, 'RACK', 'R7', 'Rack 7'),
      children: [{ location: { ...loc(4, 'SHELF', 'R7-L2', 'Chiller · Rack 7 · L2'), levelIndex: 2 }, children: [] }],
    }],
  },
  { location: loc(5, 'ZONE', 'Z2', 'Dry'), children: [{ location: loc(6, 'BIN', 'D-1', 'Dry bay 1'), children: [] }] },
]

function Tree({ selected = null as number | null }) {
  return (
    <WarehouseTreePanel tree={tree} binContents={new Map()} binFillPct={new Map()} selectedLocationId={selected} onSelect={vi.fn()} />
  )
}

describe('WarehouseTreePanel', () => {
  it('starts with every group collapsed and opens the groups above a selected place', () => {
    const { rerender } = render(<Tree />)
    // Only the top-level groups show; nothing inside them is open.
    expect(screen.getByText('Chiller')).toBeTruthy()
    expect(screen.getByText('Dry')).toBeTruthy()
    expect(screen.queryByText('Rack 7')).toBeNull()
    expect(screen.queryByText('Dry bay 1')).toBeNull()

    // A click opens one group, and only that one.
    fireEvent.click(screen.getByText('Dry'))
    expect(screen.getByText('Dry bay 1')).toBeTruthy()
    expect(screen.queryByText('Rack 7')).toBeNull()

    // Selecting a place (from the map) opens every group above it.
    rerender(<Tree selected={4} />)
    expect(screen.getByText('Rack 7')).toBeTruthy()
    expect(screen.getByText('Chiller · Rack 7 · L2')).toBeTruthy()
  })

  // NX-0046 A7: a rack level holds stock exactly as a bin does.
  it('shows fill and product count on a rack level', () => {
    render(
      <WarehouseTreePanel
        tree={tree}
        binContents={new Map([[4, [{}, {}]]]) as never}
        binFillPct={new Map([[4, 0.5]])}
        selectedLocationId={4}
        onSelect={vi.fn()}
      />,
    )
    const row = screen.getByText('Chiller · Rack 7 · L2').closest('button')!
    expect(row.textContent).toContain('50%')
    expect(row.textContent).toContain('2 SKU')
    // A rack is a group, not a place stock sits: no pill of its own.
    expect(screen.getByText('Rack 7').closest('button')!.textContent).not.toContain('%')
  })
})
