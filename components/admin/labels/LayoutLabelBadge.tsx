// "38 locations have no label" — the backlog, wherever a published layout is on
// screen, with the print job one click away.
//
// A published layout with unlabelled bins is a warehouse where directed putaway
// sends someone to a bay they cannot scan. That is invisible until an operator
// is standing in front of it, so the count belongs on the layout itself rather
// than buried in Settings.

import React, { useState } from 'react'
import { Barcode, CheckCircle2 } from 'lucide-react'
import { useLayoutLabelStatus } from '@/hooks/queries/useLabelJobs'
import LayoutLabelJobModal from './LayoutLabelJobModal'

export interface LayoutLabelBadgeProps {
  layoutId: number
  layoutName?: string
  /**
   * The site this layout belongs to. Optional only because the type cannot force
   * it, but every mount should pass it: without it the job modal resolves sheet
   * stocks from the built-in defaults while the server applies the site's saved
   * `warehouse_label_prefs`, so the preview and the offset ceiling describe a
   * different sheet from the one that prints.
   */
  warehouseId?: number
  /** Compact rendering for a toolbar row. */
  dense?: boolean
}

export function LayoutLabelBadge({
  layoutId,
  layoutName,
  warehouseId,
  dense = false,
}: LayoutLabelBadgeProps) {
  const [open, setOpen] = useState(false)
  const status = useLayoutLabelStatus(layoutId)

  const outstanding = status.data?.outstanding ?? 0
  const total = status.data?.total ?? 0
  const complete = status.isSuccess && total > 0 && outstanding === 0

  // Nothing to say before the first load, and nothing to say about a layout with
  // no labellable locations at all.
  if (!status.isSuccess || total === 0) return null

  const pad = dense ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-lg border btn-press ${pad} ${
          complete
            ? 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50'
            : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
        }`}
        title={
          complete
            ? `All ${total} locations on this layout are labelled`
            : `${outstanding} of ${total} locations have no barcode label yet`
        }
      >
        {complete ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>All {total} labelled</span>
          </>
        ) : (
          <>
            <Barcode className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {outstanding} location{outstanding === 1 ? '' : 's'} need
              {outstanding === 1 ? 's' : ''} a label
            </span>
          </>
        )}
      </button>

      {open && (
        <LayoutLabelJobModal
          open={open}
          onClose={() => setOpen(false)}
          layoutId={layoutId}
          layoutName={layoutName}
          warehouseId={warehouseId}
        />
      )}
    </>
  )
}

export default LayoutLabelBadge
