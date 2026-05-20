// Admin tile showing PO Inbox health at a glance.
//
// Two presentation variants:
//   * 'card' — original chunky tile used by AdminDashboard, where the tile is
//     one of several elevated surfaces competing for attention.
//   * 'inline' — flat horizontal KPI strip used inside POInboxView, where the
//     tile lives in a page header and needs to feel quiet, not stack another
//     card on top of the existing page chrome.

import React from 'react'
import { AlertTriangle, CheckCircle2, DollarSign, Inbox } from 'lucide-react'
import { usePoInboxStats } from '@/hooks/queries/usePoInboxStats'
import {
  describeCost,
  describeRatio,
  thresholdTone,
} from './poInboxStatsFormat'

type Tone = 'default' | 'emerald' | 'amber' | 'rose'

interface POInboxStatsTileProps {
  onNavigate?: () => void
  variant?: 'card' | 'inline'
}

const POInboxStatsTile: React.FC<POInboxStatsTileProps> = ({
  onNavigate,
  variant = 'card',
}) => {
  const { data, isLoading } = usePoInboxStats()

  const received = isLoading ? '…' : String(data?.todayCount ?? 0)
  const autoApproved =
    isLoading || !data ? '…' : describeRatio(data.autoApprovedRatio, data.todayAutoApproved)
  const backlog = isLoading ? '…' : String(data?.needsReviewBacklog ?? 0)
  const backlogTone: Tone = thresholdTone(data?.needsReviewBacklog ?? 0, [1, 5])
  const costToday = isLoading || !data ? '…' : describeCost(data.costUsdToday)

  if (variant === 'inline') {
    return (
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <InlineStat label="Received" value={received} />
        <InlineDivider />
        <InlineStat label="Auto-approved" value={autoApproved} tone="emerald" />
        <InlineDivider />
        <InlineStat label="Needs review" value={backlog} tone={backlogTone} />
        <InlineDivider />
        <InlineStat label="Cost today" value={costToday} />
        {data?.costUsdSevenDayAvg != null && (
          <span className="text-[11px] text-stone-500">
            7-day avg {describeCost(data.costUsdSevenDayAvg)}/day
          </span>
        )}
      </dl>
    )
  }

  return (
    <div className="rounded-2xl bg-white shadow-card border border-stone-200 p-5 space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-stone-600" />
          <h3 className="font-display font-semibold text-stone-900 text-sm">PO Inbox today</h3>
        </div>
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            className="text-xs font-medium text-nexgen-blue hover:text-nexgen-blue/80 btn-press"
          >
            Open inbox →
          </button>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3">
        <CardStat label="Received" value={received} icon={<Inbox className="w-3 h-3" />} />
        <CardStat
          label="Auto-approved"
          value={autoApproved}
          tone="emerald"
          icon={<CheckCircle2 className="w-3 h-3" />}
        />
        <CardStat
          label="Needs review (all time)"
          value={backlog}
          tone={backlogTone}
          icon={<AlertTriangle className="w-3 h-3" />}
        />
        <CardStat label="Cost today" value={costToday} icon={<DollarSign className="w-3 h-3" />} />
      </div>

      {data && data.costUsdSevenDayAvg != null && (
        <p className="text-[11px] text-stone-500 leading-tight">
          7-day avg: {describeCost(data.costUsdSevenDayAvg)} / day
        </p>
      )}
    </div>
  )
}

const TONE_STYLES: Record<Tone, string> = {
  default: 'bg-stone-50 text-stone-700 border-stone-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
}

const INLINE_VALUE_TONE: Record<Tone, string> = {
  default: 'text-stone-900',
  emerald: 'text-emerald-700',
  amber: 'text-amber-700',
  rose: 'text-rose-700',
}

interface CardStatProps {
  label: string
  value: string
  icon?: React.ReactNode
  tone?: Tone
}

const CardStat: React.FC<CardStatProps> = ({ label, value, icon, tone = 'default' }) => {
  const className = TONE_STYLES[tone] ?? TONE_STYLES.default
  return (
    <div className={`rounded-lg border px-3 py-2 ${className}`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide opacity-70">
        {icon}
        {label}
      </div>
      <div className="font-mono text-base mt-0.5 leading-tight">{value}</div>
    </div>
  )
}

interface InlineStatProps {
  label: string
  value: string
  tone?: Tone
}

const InlineStat: React.FC<InlineStatProps> = ({ label, value, tone = 'default' }) => (
  <div className="flex items-baseline gap-2">
    <dt className="text-[11px] uppercase tracking-wide text-stone-500">{label}</dt>
    <dd className={`font-mono text-sm ${INLINE_VALUE_TONE[tone]}`}>{value}</dd>
  </div>
)

const InlineDivider: React.FC = () => (
  <span aria-hidden className="h-4 w-px bg-stone-200" />
)

export default POInboxStatsTile
