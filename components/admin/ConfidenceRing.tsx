// ConfidenceRing — a conic-gradient meter whose fill is proportional to the
// 0..1 AI-extraction confidence, colour-banded via confidenceBand, with the
// percentage in the centre. Shared by the Queue rows (sm) and the detail
// modal header (md).

import React from 'react'
import { confidenceBand } from './poInboxFormat'

interface ConfidenceRingProps {
  /** 0..1 confidence. */
  value: number
  size?: 'sm' | 'md'
  /** Optional visible label under the ring explaining what the % means
   *  (so the meaning isn't hidden behind a hover tooltip). */
  caption?: string
}

const DIMENSIONS = {
  sm: { outer: 44, inner: 34, font: 'text-[11px]' },
  md: { outer: 48, inner: 37, font: 'text-xs' },
} as const

const ConfidenceRing: React.FC<ConfidenceRingProps> = ({ value, size = 'sm', caption }) => {
  const band = confidenceBand(value)
  const pct = Math.round(value * 100)
  const dim = DIMENSIONS[size]
  const ring = (
    <div
      role="img"
      aria-label={`AI confidence ${pct}%`}
      title={`AI confidence ${pct}%`}
      className="shrink-0 rounded-full flex items-center justify-center"
      style={{
        width: dim.outer,
        height: dim.outer,
        background: `conic-gradient(${band.ringColor} ${pct}%, ${band.trackColor} 0)`,
      }}
    >
      <span
        className={`rounded-full bg-white flex items-center justify-center font-mono font-semibold ${dim.font} ${band.textClass}`}
        style={{ width: dim.inner, height: dim.inner }}
      >
        {pct}%
      </span>
    </div>
  )

  if (!caption) return ring
  return (
    <div className="shrink-0 flex flex-col items-center gap-0.5">
      {ring}
      <span className="text-[9px] uppercase tracking-wide text-stone-400 font-medium leading-none">
        {caption}
      </span>
    </div>
  )
}

export default ConfidenceRing
