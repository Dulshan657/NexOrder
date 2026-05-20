// Header bell badge that surfaces the count of pending_pos awaiting
// human review. Clicking navigates the admin shell to the PO Inbox tab.
// Realtime updates flow in via useRealtimeSubscriptions invalidating
// the pending_pos query keys.

import React from 'react'
import { Inbox } from 'lucide-react'
import { usePendingPoCount } from '@/hooks/queries/usePendingPos'

interface POInboxHeaderBadgeProps {
  onClick: () => void
}

const POInboxHeaderBadge: React.FC<POInboxHeaderBadgeProps> = ({ onClick }) => {
  const { data: count = 0 } = usePendingPoCount()

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative p-2 rounded-lg hover:bg-stone-100 text-stone-700 btn-press"
      title={count > 0 ? `${count} PO${count === 1 ? '' : 's'} awaiting review` : 'PO Inbox'}
      aria-label={`PO Inbox${count > 0 ? `, ${count} awaiting review` : ''}`}
    >
      <Inbox className="w-5 h-5" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 min-w-[18px] h-[18px] text-[10px] font-semibold text-white leading-none po-badge-pulse">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}

export default POInboxHeaderBadge
