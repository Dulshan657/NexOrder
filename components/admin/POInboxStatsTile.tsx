// Admin tile showing PO Inbox health at a glance.
//
// Two presentation variants:
//   * 'card' — original chunky tile used by AdminDashboard, where the tile is
//     one of several elevated surfaces competing for attention.
//   * 'inline' — flat KPI strip used inside POInboxView, in a row under the page
//     title, where it needs to feel quiet, not stack another card on top of the
//     existing page chrome. Two by two below `sm`, a single row above it.

import React from 'react'
import { usePoInboxStats } from '@/hooks/queries/usePoInboxStats'
import DashCard from '@/components/dashboard/DashCard'
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
      <dl className="grid grid-cols-2 sm:inline-flex sm:items-stretch rounded-xl border border-stone-200 bg-white overflow-hidden sm:divide-x divide-stone-200/70">
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

  // The dashboard card: same card, title and number face as the rest of the
  // page (NX-0042) — no monospace capitals, no tinted boxes.
  return (
    <DashCard
      title="PO Inbox today"
      caption={data && data.costUsdSevenDayAvg != null ? `7-day avg cost ${describeCost(data.costUsdSevenDayAvg)} / day` : undefined}
      action={onNavigate ? { label: 'Open inbox', onClick: onNavigate } : undefined}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <CardStat label="Received" value={received} />
        <CardStat label="Auto-approved" value={autoApproved} tone="emerald" />
        <CardStat label="Needs review" value={backlog} tone={backlogTone} />
        <CardStat label="Cost today" value={costToday} />
      </dl>
    </DashCard>
  )
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
  tone?: Tone
}

const CARD_VALUE_TONE: Record<Tone, string> = {
  default: 'text-stone-900',
  emerald: 'text-emerald-700',
  amber: 'text-amber-700',
  rose: 'text-rose-700',
}

const CardStat: React.FC<CardStatProps> = ({ label, value, tone = 'default' }) => (
  <div>
    <dt className="text-[13px] text-stone-600">{label}</dt>
    <dd className={`mt-0.5 font-display text-xl font-semibold tabular-nums tracking-tight ${CARD_VALUE_TONE[tone]}`}>{value}</dd>
  </div>
)

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
