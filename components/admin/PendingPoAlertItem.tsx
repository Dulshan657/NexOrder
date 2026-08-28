import React from 'react'
import { Inbox } from 'lucide-react'
import type { PendingPoSummaryRow } from '@/services/supabase/poInboxService'
import { formatAge, confidenceBadgeStyle } from './poInboxFormat'

interface PendingPoAlertItemProps {
  row: PendingPoSummaryRow
  onClick: () => void
}

/**
 * One pending-PO alert row inside the NotificationCenter dropdown.
 * Mirrors the queue's data (sender, subject, age, confidence) but in a
 * compact form. Clicking routes the operator to the PO Inbox queue.
 */
const PendingPoAlertItem: React.FC<PendingPoAlertItemProps> = ({ row, onClick }) => {
  const subject = row.subject?.trim() || '(no subject)'
  const confidencePct = Math.round((row.confidence_overall ?? 0) * 100)

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 flex gap-3 transition-colors cursor-pointer hover:bg-stone-50"
    >
      <div className="p-1.5 rounded-md flex-shrink-0 bg-amber-50 text-amber-600">
        <Inbox className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-stone-800 truncate">{subject}</p>
        <p className="text-[11px] text-stone-500 mt-0.5 truncate">
          {row.from_address || 'unknown sender'} · {formatAge(row.received_at)}
        </p>
      </div>
      <span
        className={`flex-shrink-0 self-start inline-flex items-center rounded-full border px-1.5 h-[18px] text-[10px] font-semibold leading-none ${confidenceBadgeStyle(row.confidence_overall ?? 0)}`}
      >
        {confidencePct}%
      </span>
    </button>
  )
}

export default PendingPoAlertItem
