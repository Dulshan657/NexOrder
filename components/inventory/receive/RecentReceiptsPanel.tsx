// The last few receipts, for context and an audit trail. Closed by default
// since NX-0005: it sat between the operator and the scan field for years and is
// read far less often than it is scrolled past. The list (and its query) mounts
// only when opened.

import React, { useState } from 'react'
import { Boxes, ChevronDown, Clock, History, Truck } from 'lucide-react'
import { useRecentReceipts } from '../../../hooks/queries/useInventoryBalances'

/** Compact relative-time label ("just now", "3h ago", "2d ago"). */
const relativeTime = (iso: string): string => {
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  if (Number.isNaN(diffMs)) return ''
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-AU')
}

function RecentReceiptsList() {
  const { data: receipts, isLoading } = useRecentReceipts(8)

  if (isLoading) {
    return (
      <div className="divide-y divide-stone-100">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 h-3.5 rounded bg-stone-100 animate-pulse" />
            <div className="w-12 h-3.5 rounded bg-stone-100 animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  if (!receipts || receipts.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <Boxes className="w-8 h-8 text-stone-200 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm text-stone-600">No goods received yet</p>
        <p className="text-xs text-stone-600 mt-1">Receipts you record will show up here.</p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-stone-100">
      {receipts.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-stone-800 truncate">{r.productName}</p>
            <p className="text-xs text-stone-600 font-mono">
              {r.productSku}
              {r.lotCode ? ` · lot ${r.lotCode}` : ''}
              {r.expiryDate ? ` · exp ${r.expiryDate}` : ''}
            </p>
            {r.supplierName && (
              <p className="text-xs text-stone-600 flex items-center gap-1 mt-0.5">
                <Truck className="w-3 h-3" aria-hidden="true" /> {r.supplierName}
              </p>
            )}
          </div>
          <span className="font-mono text-sm text-emerald-700 shrink-0">+{r.qty}</span>
          <span className="flex items-center gap-1 text-xs text-stone-600 shrink-0 w-20 justify-end">
            <Clock className="w-3 h-3" aria-hidden="true" /> {relativeTime(r.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function RecentReceiptsPanel() {
  const [open, setOpen] = useState(false)
  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="btn-press touch-target-y flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-stone-50"
      >
        <History className="w-4 h-4 text-stone-600" aria-hidden="true" />
        <h2 className="flex-1 text-sm font-semibold text-stone-700">Recent receipts</h2>
        <ChevronDown
          className={`w-4 h-4 text-stone-600 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="border-t border-stone-100">
          <RecentReceiptsList />
        </div>
      )}
    </div>
  )
}

export default RecentReceiptsPanel
