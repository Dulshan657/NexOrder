// The Locations tree beside the place detail on the warehouse map (NX-0039 A13).
// It starts COLLAPSED: the map and the detail are what an operator opens this
// page for, and the tree is the long way round to a place they can click on the
// map. The page narrows this column while it is closed (onOpenChange).

import type { ReactNode } from 'react'
import { FloatingPanel } from './FloatingPanel'

export interface LocationsPanelProps {
  className?: string
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

export function LocationsPanel({ className = '', onOpenChange, children }: LocationsPanelProps) {
  return (
    <FloatingPanel id="wh-tree" title="Locations" defaultOpen={false} className={className} onOpenChange={onOpenChange}>
      {children}
    </FloatingPanel>
  )
}
