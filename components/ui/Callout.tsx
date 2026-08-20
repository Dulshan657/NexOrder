// A tone-carrying notice box.
//
// This exists because the recode panel alone hand-rolled NINE of them — the spanned
// areas warning, the last sweep, the incumbent note, the numbering note, the refusal
// list, the stock note, the printed-label acknowledgement, the barcode verdict and
// the success panel's reprint card — each re-typing
// `rounded-lg border border-X-200 bg-X-50/70 p-2|p-3 text-[11px] text-X-900` with a
// different padding, a different opacity and, in RecodeFitVerdict, a three-branch
// inline ternary that was exactly where a fourth tone would have drifted in.
//
// The tone map is the point. It is also the one place the rose/red split in this
// codebase can be settled rather than argued about per file: `danger` is rose, which
// is what the warehouse cluster already uses. components/ui/Field keeps `red` for
// field-level validation, deliberately — a wrong value in an input is a different
// register from a refusal, and they are never adjacent.

import type { ReactNode } from 'react'

export type CalloutTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** A type alias, not `interface extends` — there is no @types/react in this repo, so
 *  an interface extending a React props type contributes no members at all. */
export type CalloutProps = {
  tone?: CalloutTone
  /** Rendered at the tone's colour, before the title. */
  icon?: ReactNode
  title?: ReactNode
  children?: ReactNode
  /** A button or link, laid out below the body so it never competes with it. */
  action?: ReactNode
  /** Tighter padding and type, for dense panels. */
  dense?: boolean
  className?: string
}

const TONE: Record<CalloutTone, { box: string; title: string; body: string; icon: string }> = {
  neutral: {
    box: 'border-stone-200 bg-stone-50/70',
    title: 'text-stone-800',
    body: 'text-stone-600',
    icon: 'text-stone-400',
  },
  info: {
    box: 'border-nexgen-blue/25 bg-nexgen-blue-light/50',
    title: 'text-nexgen-blue-dark',
    body: 'text-stone-600',
    icon: 'text-nexgen-blue',
  },
  success: {
    box: 'border-emerald-200 bg-emerald-50/70',
    title: 'text-emerald-800',
    body: 'text-emerald-900',
    icon: 'text-emerald-600',
  },
  warning: {
    box: 'border-amber-200 bg-amber-50/70',
    title: 'text-amber-800',
    body: 'text-amber-900',
    icon: 'text-amber-500',
  },
  danger: {
    box: 'border-rose-200 bg-rose-50/70',
    title: 'text-rose-800',
    body: 'text-rose-900',
    icon: 'text-rose-500',
  },
}

export function Callout({
  tone = 'neutral',
  icon,
  title,
  children,
  action,
  dense = false,
  className = '',
}: CalloutProps) {
  const t = TONE[tone]
  return (
    <div className={`rounded-lg border ${t.box} ${dense ? 'p-2.5' : 'p-3'} ${className}`}>
      {(icon || title) && (
        <div className={`flex items-center gap-1.5 text-xs font-semibold ${t.title}`}>
          {icon && <span className={`shrink-0 ${t.icon}`}>{icon}</span>}
          {title}
        </div>
      )}
      {children && (
        <div
          className={`${dense ? 'text-[11px]' : 'text-xs'} leading-relaxed ${t.body} ${
            icon || title ? 'mt-1' : ''
          }`}
        >
          {children}
        </div>
      )}
      {action && <div className="mt-2 flex flex-wrap gap-1.5">{action}</div>}
    </div>
  )
}
