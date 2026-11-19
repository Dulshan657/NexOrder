import React from 'react'
import { formatShortDate } from '../../lib/dashboardFormat'

/** At or above: on track. Below ON_TRACK but at or above AT_RISK: amber. */
export const TARGET_ON_TRACK_PCT = 60
export const TARGET_AT_RISK_PCT = 30

export function targetTone(percent: number): 'good' | 'warn' | 'bad' {
  if (percent >= TARGET_ON_TRACK_PCT) return 'good'
  if (percent >= TARGET_AT_RISK_PCT) return 'warn'
  return 'bad'
}

const BAR: Record<ReturnType<typeof targetTone>, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
}

const TEXT: Record<ReturnType<typeof targetTone>, string> = {
  good: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-red-700',
}

interface TargetBarProps {
  label: string
  /** Already formatted, e.g. "$6,000". */
  achieved: string
  target: string
  percent: number
  startDate?: string
  endDate?: string
  /** A hint under the bar, e.g. "Need $420/day for 9d". */
  hint?: string
}

/** One target progress row, shared by both dashboards (NX-0041). */
export default function TargetBar({ label, achieved, target, percent, startDate, endDate, hint }: TargetBarProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))
  const tone = targetTone(pct)
  const range = startDate && endDate ? `${formatShortDate(startDate)} – ${formatShortDate(endDate)}` : null

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-stone-800">{label}</span>
        <span className="text-xs tabular-nums text-stone-600">{achieved} / {target}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-stone-100"
      >
        <div className={`h-full rounded-full ${BAR[tone]} transition-[width] duration-500 ease-out`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="text-stone-500 truncate">{hint ?? range ?? ''}</span>
        <span className={`font-semibold tabular-nums ${TEXT[tone]}`}>{Math.round(pct)}%</span>
      </div>
      {hint && range && <p className="text-xs text-stone-500">{range}</p>}
    </div>
  )
}
