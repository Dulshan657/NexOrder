import type { StatusTone, VoiceStatus } from './voiceStatus'

// The one-line answer to "what is it doing": a dot and a word, announced politely
// as it changes. The clock and the day's minutes sit beside it, unannounced, so a
// screen reader is not read a new number every second.

const DOT: Readonly<Record<StatusTone, string>> = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  blue: 'bg-nexgen-blue',
  stone: 'bg-stone-400',
  rose: 'bg-rose-500',
}

export interface VoiceStatusPillProps {
  status: VoiceStatus
  elapsed: string
  today: string | null
}

export function VoiceStatusPill({ status, elapsed, today }: VoiceStatusPillProps) {
  return (
    <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
      <div
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1 text-sm font-semibold text-stone-800"
      >
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          {status.pulse && (
            <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${DOT[status.tone]}`} />
          )}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${DOT[status.tone]}`} />
        </span>
        {status.label}
      </div>
      <div className="flex items-center gap-3 text-xs text-stone-600 font-mono tabular-nums">
        <span>{elapsed}</span>
        {today && <span>{today}</span>}
      </div>
    </div>
  )
}
