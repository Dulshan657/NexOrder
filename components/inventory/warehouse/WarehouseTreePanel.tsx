// The location tree beside the grid: Zone → Aisle → Rack → Bin, each bin showing
// a fill pill + product count. Clicking any node selects it (the page highlights
// a zone's descendant bins on the grid, or opens a bin's detail). When selection
// changes from the grid side, the matching node auto-expands its ancestors and
// scrolls into view — keeping the two views in sync.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { InventoryLocation } from '@/types'
import type { LocationTreeNode, BinContentRow } from './useWarehouseViewerModel'
import { occupancyPill } from './warehouseOverlays'

interface WarehouseTreePanelProps {
  tree: LocationTreeNode[]
  binContents: Map<number, BinContentRow[]>
  binFillPct: Map<number, number | null>
  selectedLocationId: number | null
  onSelect: (location: InventoryLocation) => void
}

export function WarehouseTreePanel({
  tree,
  binContents,
  binFillPct,
  selectedLocationId,
  onSelect,
}: WarehouseTreePanelProps) {
  // Parent lookup for ancestor auto-expansion.
  const parentOf = useMemo(() => {
    const map = new Map<number, number | undefined>()
    const walk = (node: LocationTreeNode, parentId?: number) => {
      map.set(node.location.id, parentId)
      node.children.forEach((c) => walk(c, node.location.id))
    }
    tree.forEach((n) => walk(n))
    return map
  }, [tree])

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const rowRefs = useRef(new Map<number, HTMLButtonElement>())
  const didInit = useRef(false)

  // Default: expand the top level (zones) once, when the tree first arrives.
  // A ref-guard (not prev.size) so a later "collapse all" isn't undone by a
  // background refetch rebuilding `tree`.
  useEffect(() => {
    if (didInit.current || tree.length === 0) return
    didInit.current = true
    setExpanded(new Set(tree.map((n) => n.location.id)))
  }, [tree])

  // External selection → expand ancestors + scroll into view.
  useEffect(() => {
    if (selectedLocationId == null) return
    setExpanded((prev) => {
      const next = new Set(prev)
      let cur = parentOf.get(selectedLocationId)
      while (cur != null) {
        next.add(cur)
        cur = parentOf.get(cur)
      }
      return next
    })
  }, [selectedLocationId, parentOf])

  useLayoutEffect(() => {
    if (selectedLocationId == null) return
    rowRefs.current.get(selectedLocationId)?.scrollIntoView({ block: 'nearest' })
  }, [selectedLocationId, expanded])

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const renderNode = (node: LocationTreeNode, depth: number): ReactNode => {
    const { location } = node
    const isBin = location.kind === 'BIN'
    const hasChildren = node.children.length > 0
    const isOpen = expanded.has(location.id)
    const selected = location.id === selectedLocationId
    const pct = isBin ? binFillPct.get(location.id) : undefined
    const count = isBin ? binContents.get(location.id)?.length ?? 0 : undefined

    return (
      <div key={location.id}>
        <button
          ref={(el) => {
            if (el) rowRefs.current.set(location.id, el)
            else rowRefs.current.delete(location.id)
          }}
          onClick={() => {
            if (hasChildren) toggle(location.id)
            onSelect(location)
          }}
          className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs btn-press ${
            selected ? 'bg-nexgen-blue/10 text-nexgen-blue font-medium' : 'hover:bg-stone-100 text-stone-700'
          }`}
          style={{ paddingLeft: depth * 14 + 6 }}
        >
          {hasChildren ? (
            isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <span className="font-mono text-[11px] shrink-0">{location.code}</span>
          <span className="truncate text-stone-500">{location.name}</span>
          {isBin && (
            <span className="ml-auto flex items-center gap-1 shrink-0">
              {count ? <span className="text-[10px] text-stone-400">{count} SKU</span> : null}
              <span className={`rounded px-1 py-0.5 text-[10px] font-semibold ${occupancyPill(pct)}`}>
                {pct == null ? '—' : `${Math.round(pct * 100)}%`}
              </span>
            </span>
          )}
        </button>
        {hasChildren && isOpen && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  if (tree.length === 0) {
    return <p className="p-4 text-xs text-stone-400">No storage locations defined for this warehouse.</p>
  }

  return <div className="py-1">{tree.map((n) => renderNode(n, 0))}</div>
}
