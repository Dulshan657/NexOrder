// POInboxTab — admin queue for inbound POs extracted from email.
//
// Lists pending_pos with status filters. Realtime invalidation pushes
// new rows in without a refresh. Clicking a row opens the detail modal
// (separate component to keep this file small).

import React, { Suspense, lazy, useMemo, useState } from 'react'
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react'
import { usePendingPos } from '@/hooks/queries/usePendingPos'
import {
  PO_INBOX_TABS,
  confidenceBadgeStyle,
  formatAge,
  statusBadge,
  sortForDisplay,
} from './poInboxFormat'
import type { PendingPoStatus, PendingPoSummaryRow } from '@/services/supabase/poInboxService'
import type { HoReCa } from '../../types'

const POInboxDetailModal = lazy(() => import('./POInboxDetailModal'))

interface POInboxTabProps {
  hoReCas: HoReCa[]
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
}

const POInboxTab: React.FC<POInboxTabProps> = ({ hoReCas, addToast }) => {
  const [activeStatus, setActiveStatus] = useState<PendingPoStatus>('needs_review')
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading, isFetching, refetch } = usePendingPos(activeStatus)
  const rows = useMemo(() => sortForDisplay(data ?? []), [data])

  const horecaById = useMemo(() => {
    const m = new Map<number, HoReCa>()
    for (const h of hoReCas) m.set(h.id, h)
    return m
  }, [hoReCas])

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Inbox className="w-5 h-5 text-stone-700" />
          <div>
            <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">PO Inbox</h1>
            <p className="text-sm text-stone-500">
              Purchase orders the AI extracted from connected mailboxes. Review the ambiguous
              ones; auto-approved POs already have a real order in the orders tab.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50 btn-press"
        >
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="PO status filter">
        {PO_INBOX_TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveStatus(tab.key as PendingPoStatus)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              activeStatus === tab.key
                ? 'bg-nexgen-blue text-white'
                : 'bg-white text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-50'
            }`}
            title={tab.description}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="rounded-xl border border-stone-200 bg-white shadow-card">
        {isLoading ? (
          <div className="p-8 flex items-center justify-center text-stone-500">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <Empty status={activeStatus} />
        ) : (
          <ul className="divide-y divide-stone-200">
            {rows.map(row => (
              <Row
                key={row.id}
                row={row}
                hoReCa={row.matched_horeca_id != null ? horecaById.get(row.matched_horeca_id) : undefined}
                onClick={() => setOpenId(row.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {openId && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60">
              <Loader2 className="w-6 h-6 animate-spin text-white" />
            </div>
          }
        >
          <POInboxDetailModal
            pendingPoId={openId}
            hoReCas={hoReCas}
            onClose={() => setOpenId(null)}
            addToast={addToast}
          />
        </Suspense>
      )}
    </div>
  )
}

const Empty: React.FC<{ status: PendingPoStatus }> = ({ status }) => (
  <div className="p-10 text-center">
    <Inbox className="w-8 h-8 mx-auto text-stone-400" />
    <p className="mt-3 text-sm text-stone-600">No POs in this tab.</p>
    {status === 'needs_review' && (
      <p className="mt-1 text-xs text-stone-500">
        Inbound emails extracted with full confidence flow straight through to Auto Approved.
      </p>
    )}
  </div>
)

interface RowProps {
  row: PendingPoSummaryRow
  hoReCa: HoReCa | undefined
  onClick: () => void
}

const Row: React.FC<RowProps> = ({ row, hoReCa, onClick }) => {
  const badge = statusBadge(row.status)
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-4 py-3 sm:px-6 sm:py-4 hover:bg-stone-50 focus:outline-none focus:bg-stone-50 transition-colors"
      >
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-stone-900 truncate">
                {row.subject?.trim() || '(no subject)'}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
                {row.status === 'needs_review' && <AlertTriangle className="w-3 h-3" />}
                {badge.label}
              </span>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${confidenceBadgeStyle(row.confidence_overall)}`}>
                {(row.confidence_overall * 100).toFixed(0)}% confidence
              </span>
            </div>
            <div className="text-xs text-stone-500 flex flex-wrap gap-x-3">
              <span>From: {row.from_address || '(unknown sender)'}</span>
              <span>
                Customer:{' '}
                <span className={row.matched_horeca_id ? '' : 'italic text-stone-400'}>
                  {hoReCa?.name ?? (row.matched_horeca_id ? `#${row.matched_horeca_id}` : 'unresolved')}
                </span>
              </span>
              <span>Received {formatAge(row.received_at)}</span>
              {row.approved_order_id && <span>Order: {row.approved_order_id}</span>}
            </div>
          </div>
        </div>
      </button>
    </li>
  )
}

export default POInboxTab
