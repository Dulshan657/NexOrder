// Admin-dashboard tile showing PO Inbox health at a glance.
//
//   * Today's volume + auto-approval ratio
//   * Backlog (POs awaiting human review across all dates)
//   * Today's extraction cost (Admin only; Manager sees blank)
//   * Click → jumps to /admin/po-inbox

import React from 'react'
import { AlertTriangle, CheckCircle2, DollarSign, Inbox } from 'lucide-react'
import { usePoInboxStats } from '@/hooks/queries/usePoInboxStats'
import {
  describeCost,
  describeRatio,
  thresholdTone,
} from './poInboxStatsFormat'

interface POInboxStatsTileProps {
  onNavigate?: () => void
}

const POInboxStatsTile: React.FC<POInboxStatsTileProps> = ({ onNavigate }) => {
  const { data, isLoading } = usePoInboxStats()

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
        <Stat
          label="Received"
          value={isLoading ? '…' : String(data?.todayCount ?? 0)}
          icon={<Inbox className="w-3 h-3" />}
        />
        <Stat
          label="Auto-approved"
          value={isLoading || !data ? '…' : describeRatio(data.autoApprovedRatio, data.todayAutoApproved)}
          tone="emerald"
          icon={<CheckCircle2 className="w-3 h-3" />}
        />
        <Stat
          label="Needs review (all time)"
          value={isLoading ? '…' : String(data?.needsReviewBacklog ?? 0)}
          tone={thresholdTone(data?.needsReviewBacklog ?? 0, [1, 5])}
          icon={<AlertTriangle className="w-3 h-3" />}
        />
        <Stat
          label="Cost today"
          value={isLoading || !data ? '…' : describeCost(data.costUsdToday)}
          icon={<DollarSign className="w-3 h-3" />}
        />
      </div>

      {data && data.costUsdSevenDayAvg != null && (
        <p className="text-[11px] text-stone-500 leading-tight">
          7-day avg: {describeCost(data.costUsdSevenDayAvg)} / day
        </p>
      )}
    </div>
  )
}

const TONE_STYLES: Record<string, string> = {
  default: 'bg-stone-50 text-stone-700 border-stone-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
}

interface StatProps {
  label: string
  value: string
  icon?: React.ReactNode
  tone?: 'default' | 'emerald' | 'amber' | 'rose'
}

const Stat: React.FC<StatProps> = ({ label, value, icon, tone = 'default' }) => {
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

export default POInboxStatsTile
