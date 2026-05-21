// POInboxTab — admin queue for inbound POs extracted from email.
//
// Lists pending_pos with status filters. Realtime invalidation pushes
// new rows in without a refresh. Clicking a row opens the detail modal
// (separate component to keep this file small).

import React, { Suspense, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, Inbox, Loader2, RefreshCw } from 'lucide-react'
import { lazyWithRetry } from '../../lib/lazyWithRetry'
import { usePendingPos, usePendingPoCount } from '@/hooks/queries/usePendingPos'
import { useProducts } from '@/hooks/queries/useProducts'
import { useSettings } from '@/hooks/queries/useSettings'
import { PO_INBOX_TABS, formatAge, sortForDisplay, statusBadge } from './poInboxFormat'
import { computePoIssues } from './poInboxIssues'
import ConfidenceRing from './ConfidenceRing'
import { senderMismatch } from '@/services/supabase/poInboxService'
import type { PendingPoStatus, PendingPoSummaryRow } from '@/services/supabase/poInboxService'
import type { HoReCa, Product } from '../../types'

const POInboxDetailModal = lazyWithRetry(() => import('./POInboxDetailModal'))

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
  const { data: needsReviewCount } = usePendingPoCount()
  const rows = useMemo(() => sortForDisplay(data ?? []), [data])

  // Products + low-stock threshold drive the per-row stock issue pill. Both
  // queries are cached app-wide, so this adds no extra network cost here.
  const { data: productsData } = useProducts()
  const products: Product[] = productsData ?? []
  const { data: settings } = useSettings()
  const lowThreshold = settings?.low_stock_threshold ?? 10
  const productById = useMemo(() => {
    const m = new Map<number, Product>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

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
              count={tab.key === 'needs_review' ? needsReviewCount : undefined}
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
          <QueueSkeleton />
        ) : rows.length === 0 ? (
          <Empty status={activeStatus} />
        ) : (
          <ul className="divide-y divide-stone-200/70 rounded-xl border border-stone-200 overflow-hidden bg-white">
            {rows.map((row, i) => (
              <Row
                key={row.id}
                row={row}
                index={i}
                hoReCa={row.matched_horeca_id != null ? horecaById.get(row.matched_horeca_id) : undefined}
                productById={productById}
                lowThreshold={lowThreshold}
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
  count?: number
  children: React.ReactNode
}

const FilterTab: React.FC<FilterTabProps> = ({ active, onClick, title, count, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`py-2.5 text-sm transition-colors border-b-2 inline-flex items-center gap-2 ${
      active
        ? 'border-stone-900 text-stone-900 font-medium'
        : 'border-transparent text-stone-500 hover:text-stone-800'
    }`}
  >
    {children}
    {typeof count === 'number' && count > 0 && (
      <span className="font-mono text-[11px] rounded-full px-1.5 leading-5 bg-amber-50 text-amber-700 border border-amber-200">
        {count > 99 ? '99+' : count}
      </span>
    )}
  </button>
)

const QueueSkeleton: React.FC = () => (
  <ul className="divide-y divide-stone-200/70 rounded-xl border border-stone-200 overflow-hidden bg-white">
    {Array.from({ length: 4 }).map((_, i) => (
      <li key={i} className="flex items-center gap-4 py-3 pl-4 pr-3">
        <div className="po-skeleton shrink-0" style={{ width: 44, height: 44, borderRadius: 999 }} />
        <div className="flex-1">
          <div className="po-skeleton" style={{ width: `${55 + (i % 3) * 12}%`, height: 12 }} />
          <div className="po-skeleton mt-2" style={{ width: `${40 + (i % 2) * 10}%`, height: 9 }} />
        </div>
        <div className="po-skeleton shrink-0" style={{ width: 74, height: 20, borderRadius: 999 }} />
      </li>
    ))}
  </ul>
)

const EMPTY_COPY: Record<PendingPoStatus, { icon: React.ReactNode; title: string; body: string; tint: string }> = {
  needs_review: {
    icon: <CheckCircle2 className="w-6 h-6 text-emerald-600" />,
    title: 'Inbox zero — nothing to review',
    body: 'High-confidence POs flow straight through to Auto Approved. Anything the AI is unsure about lands here.',
    tint: 'bg-emerald-50',
  },
  auto_approved: {
    icon: <Inbox className="w-6 h-6 text-teal-600" />,
    title: 'No auto-approved POs yet',
    body: 'When the AI extracts a PO with full confidence, it becomes an order automatically and shows up here.',
    tint: 'bg-teal-50',
  },
  approved: {
    icon: <CheckCircle2 className="w-6 h-6 text-emerald-600" />,
    title: 'Nothing approved here yet',
    body: 'POs you approve from Needs Review appear here with their created order id.',
    tint: 'bg-emerald-50',
  },
  rejected: {
    icon: <Inbox className="w-6 h-6 text-stone-400" />,
    title: 'No rejected POs',
    body: 'POs you reject (with a recorded reason) are kept here for the audit trail.',
    tint: 'bg-stone-100',
  },
}

const Empty: React.FC<{ status: PendingPoStatus }> = ({ status }) => {
  const copy = EMPTY_COPY[status]
  return (
    <div className="py-16 text-center">
      <div
        className={`mx-auto rounded-full flex items-center justify-center ${copy.tint}`}
        style={{ width: 52, height: 52 }}
      >
        {copy.icon}
      </div>
      <p className="mt-4 font-semibold text-stone-900">{copy.title}</p>
      <p className="mt-1.5 mx-auto max-w-sm text-sm text-stone-500 leading-relaxed">{copy.body}</p>
    </div>
  )
}

interface RowProps {
  row: PendingPoSummaryRow
  hoReCa: HoReCa | undefined
  index: number
  productById: Map<number, Product>
  lowThreshold: number
  onClick: () => void
}

const Row: React.FC<RowProps> = ({ row, hoReCa, index, productById, lowThreshold, onClick }) => {
  const customerName = hoReCa?.name ?? (row.matched_horeca_id ? `#${row.matched_horeca_id}` : null)
  const mismatch = senderMismatch(row.confidence_fields)
  const badge = statusBadge(row.status)
  // Non-sender issues (stock / unresolved lines / no customer) for rows still
  // awaiting review. Sender mismatch keeps its own pill below, so it's excluded
  // here (senderMismatch: null) to avoid a duplicate badge.
  const extraIssues =
    row.status === 'needs_review'
      ? computePoIssues({
          hasCustomer: row.matched_horeca_id != null,
          senderMismatch: null,
          lines: (row.matched_items ?? []).map(it => ({
            resolved: it.product_id != null,
            inventory: it.product_id != null ? productById.get(it.product_id)?.inventory ?? null : null,
            ordered: it.quantity,
          })),
          lowThreshold,
        })
      : []
  // Priority rail: rose when risky (mismatch or low confidence), else the
  // status hue. Drives the eye to the rows that need a human first.
  const risky = !!mismatch || row.confidence_overall < 0.75
  const railClass = risky
    ? 'border-rose-400'
    : row.status === 'needs_review'
      ? 'border-amber-400'
      : 'border-transparent'
  // Clamp the stagger so a long backlog doesn't cascade forever.
  const revealIndex = Math.min(index, 12)

  return (
    <li className="po-row-in" style={{ '--po-i': revealIndex } as React.CSSProperties}>
      <button
        type="button"
        onClick={onClick}
        className={`group w-full text-left flex items-center gap-4 py-3 pl-4 pr-3 border-l-[3px] ${railClass} transition-colors hover:bg-stone-50 focus:outline-none focus-visible:bg-stone-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nexgen-blue/50`}
      >
        <ConfidenceRing value={row.confidence_overall} size="sm" caption="AI" />

        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-stone-900 truncate">
              {row.subject?.trim() || '(no subject)'}
            </span>
            {row.approved_order_id && (
              <span className="text-xs font-mono text-stone-500">{row.approved_order_id}</span>
            )}
            {mismatch && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5"
                title={`Sender mismatch — ${mismatch.sender ?? 'unknown'} is not a known address for this customer. Verify before approving.`}
              >
                <AlertTriangle className="w-3 h-3" /> sender mismatch
              </span>
            )}
            {extraIssues.map(issue => (
              <span
                key={issue.kind}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"
                title={issue.detail}
              >
                <AlertTriangle className="w-3 h-3" /> {issue.label.toLowerCase()}
              </span>
            ))}
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-stone-500">
            {customerName ? (
              <span className="truncate">{customerName}</span>
            ) : (
              <span className="italic text-stone-400">unresolved</span>
            )}
            <span aria-hidden>·</span>
            <span className="truncate">{row.from_address || 'unknown sender'}</span>
            <span aria-hidden>·</span>
            <span>{formatAge(row.received_at)}</span>
          </span>
        </span>

        <span
          className={`shrink-0 text-[11px] font-medium rounded-full border px-2.5 py-0.5 ${badge.className}`}
        >
          {badge.label}
        </span>

        {/* Hover/focus affordance: chevron swaps to a Review pill. */}
        <span className="shrink-0 min-w-[72px] flex justify-end" aria-hidden>
          <ChevronRight className="w-4 h-4 text-stone-300 group-hover:hidden group-focus-visible:hidden" />
          <span className="hidden group-hover:inline-flex group-focus-visible:inline-flex items-center gap-1 text-xs font-semibold text-nexgen-blue border border-nexgen-blue/30 bg-white rounded-lg px-2.5 py-1">
            Review <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </span>
      </button>
    </li>
  )
}

export default POInboxTab
