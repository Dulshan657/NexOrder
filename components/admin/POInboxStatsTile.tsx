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
      <dl className="inline-flex items-stretch rounded-xl border border-stone-200 bg-white overflow-hidden divide-x divide-stone-200/70">
        <RibbonStat label="Received" value={received} />
        <RibbonStat label="Auto-approved" value={autoApproved} tone="emerald" />
        <RibbonStat label="Needs review" value={backlog} tone={backlogTone} emphasise />
        <RibbonStat
          label="Cost today"
          value={costToday}
          sub={data?.costUsdSevenDayAvg != null ? `7d ${describeCost(data.costUsdSevenDayAvg)}/d` : undefined}
        />
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

interface RibbonStatProps {
  label: string
  value: string
  tone?: Tone
  sub?: string
  emphasise?: boolean
}

const RibbonStat: React.FC<RibbonStatProps> = ({ label, value, tone = 'default', sub, emphasise }) => (
  <div className={`px-4 py-2 text-right ${emphasise ? 'bg-amber-50' : ''}`}>
    <dt
      className={`text-[10px] uppercase tracking-wide ${
        emphasise ? 'text-amber-700' : 'text-stone-500'
      }`}
    >
      {label}
    </dt>
    <dd className={`font-mono text-base leading-tight ${INLINE_VALUE_TONE[tone]} ${emphasise ? 'font-bold' : 'font-semibold'}`}>
      {value}
    </dd>
    {sub && <div className="text-[10px] font-mono text-stone-500 leading-tight">{sub}</div>}
  </div>
)

export default POInboxStatsTile
