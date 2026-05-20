// POInboxTab — admin queue for inbound POs extracted from email.
//
// Lists pending_pos with status filters. Realtime invalidation pushes
// new rows in without a refresh. Clicking a row opens the detail modal
// (separate component to keep this file small).

import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react'
import { usePendingPos } from '@/hooks/queries/usePendingPos'
import { PO_INBOX_TABS, formatAge, sortForDisplay } from './poInboxFormat'
import { senderMismatch } from '@/services/supabase/poInboxService'
import type { PendingPoStatus, PendingPoSummaryRow } from '@/services/supabase/poInboxService'
import type { HoReCa } from '../../types'

const POInboxDetailModal = lazy(() => import('./POInboxDetailModal'))

interface POInboxTabProps {
  hoReCas: HoReCa[]
  addToast?: (message: string, type: 'success' | 'error' | 'info') => void
  /**
   * Initial pending_po row to open in the detail modal — used when the
   * Aliases sub-tab deep-links via "View source PO". One-shot; cleared
   * after the modal mounts.
   */
  presetPendingPoId?: string | null
  onViewInOrderImport?: (orderId: string) => void
}

const POInboxTab: React.FC<POInboxTabProps> = ({
  hoReCas,
  addToast,
  presetPendingPoId,
  onViewInOrderImport,
}) => {
  const [activeStatus, setActiveStatus] = useState<PendingPoStatus>('needs_review')
  const [openId, setOpenId] = useState<string | null>(presetPendingPoId ?? null)

  useEffect(() => {
    if (presetPendingPoId) setOpenId(presetPendingPoId)
  }, [presetPendingPoId])

  const { data, isLoading, isFetching, refetch } = usePendingPos(activeStatus)
  const rows = useMemo(() => sortForDisplay(data ?? []), [data])

  const horecaById = useMemo(() => {
    const m = new Map<number, HoReCa>()
    for (const h of hoReCas) m.set(h.id, h)
    return m
  }, [hoReCas])

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-stone-200/70">
        <nav className="flex items-center gap-6 -mb-px" aria-label="PO status filter">
          {PO_INBOX_TABS.map(tab => (
            <FilterTab
              key={tab.key}
              active={activeStatus === tab.key}
              onClick={() => setActiveStatus(tab.key as PendingPoStatus)}
              title={tab.description}
            >
              {tab.label}
            </FilterTab>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-stone-500 hover:text-stone-800 p-1.5 rounded-md hover:bg-stone-100 btn-press"
          aria-label="Refresh"
          title="Refresh"
        >
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      <div className="mt-2">
        {isLoading ? (
          <div className="py-10 flex items-center justify-center text-stone-500">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <Empty status={activeStatus} />
        ) : (
          <ul className="divide-y divide-stone-200/70">
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
      </div>

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
            onViewInOrderImport={onViewInOrderImport}
          />
        </Suspense>
      )}
    </div>
  )
}

interface FilterTabProps {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}

const FilterTab: React.FC<FilterTabProps> = ({ active, onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`py-2.5 text-sm transition-colors border-b-2 ${
      active
        ? 'border-stone-900 text-stone-900 font-medium'
        : 'border-transparent text-stone-500 hover:text-stone-800'
    }`}
  >
    {children}
  </button>
)

const Empty: React.FC<{ status: PendingPoStatus }> = ({ status }) => (
  <div className="py-16 text-center">
    <Inbox className="w-8 h-8 mx-auto text-stone-300" />
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

const STATUS_LABEL: Record<PendingPoStatus, string> = {
  needs_review: 'needs review',
  auto_approved: 'auto-approved',
  approved: 'approved',
  rejected: 'rejected',
}

const STATUS_TONE: Record<PendingPoStatus, string> = {
  needs_review: 'text-amber-700',
  auto_approved: 'text-teal-700',
  approved: 'text-emerald-700',
  rejected: 'text-rose-700',
}

function confidenceTone(c: number): string {
  if (c >= 0.95) return 'text-emerald-700'
  if (c >= 0.75) return 'text-amber-700'
  return 'text-rose-700'
}

const Row: React.FC<RowProps> = ({ row, hoReCa, onClick }) => {
  const isNeedsReview = row.status === 'needs_review'
  const customerName = hoReCa?.name ?? (row.matched_horeca_id ? `#${row.matched_horeca_id}` : null)
  const mismatch = senderMismatch(row.confidence_fields)
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`group w-full text-left py-3 pr-4 hover:bg-stone-50 focus:outline-none focus:bg-stone-50 transition-colors border-l-2 ${
          isNeedsReview ? 'border-amber-400 pl-4' : 'border-transparent pl-4'
        }`}
      >
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-medium text-stone-900 truncate">
            {row.subject?.trim() || '(no subject)'}
          </span>
          {customerName ? (
            <span className="text-sm text-stone-600">{customerName}</span>
          ) : (
            <span className="text-sm italic text-stone-400">unresolved</span>
          )}
          {row.approved_order_id && (
            <span className="text-xs font-mono text-stone-500">{row.approved_order_id}</span>
          )}
          {mismatch && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5"
              title={`Sender mismatch — ${mismatch.sender ?? 'unknown'} is not a known address for this customer. Verify before approving.`}
            >
              <AlertTriangle className="w-3 h-3" /> sender mismatch
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-stone-500 flex flex-wrap gap-x-3">
          <span className="truncate">{row.from_address || 'unknown sender'}</span>
          <span aria-hidden>·</span>
          <span>{formatAge(row.received_at)}</span>
          <span aria-hidden>·</span>
          <span className={`font-mono ${confidenceTone(row.confidence_overall)}`}>
            {(row.confidence_overall * 100).toFixed(0)}%
          </span>
          <span aria-hidden>·</span>
          <span className={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</span>
        </div>
      </button>
    </li>
  )
}

export default POInboxTab
