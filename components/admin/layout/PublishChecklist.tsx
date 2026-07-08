// Live publish-readiness panel for the layout designer. Renders the four publish
// gates (dock · walkways · bins · reachability) as they change on the canvas, so
// the operator sees exactly what's missing BEFORE clicking Publish — instead of
// learning it from a server rejection after the fact. The checks come from the
// same pure module the publish-layout edge function uses, so the panel can never
// drift from the authoritative gate.

import { CheckCircle2, XCircle, CircleDashed } from 'lucide-react'
import type { ReadinessResult } from '@/supabase/functions/_shared/wie/publishReadiness'

interface PublishChecklistProps {
  readiness: ReadinessResult
}

export function PublishChecklist({ readiness }: PublishChecklistProps) {
  const toFix = readiness.checks.filter((c) => c.status === 'fail').length

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-stone-700">Publish readiness</p>
        {readiness.ready ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Ready</span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            {toFix} to fix
          </span>
        )}
      </div>

      <ul className="mt-2.5 space-y-2">
        {readiness.checks.map((c) => (
          <li key={c.code} className="flex items-start gap-2 text-xs">
            {c.status === 'pass' ? (
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2.5} />
            ) : c.status === 'fail' ? (
              <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2.5} />
            ) : (
              <CircleDashed className="mt-px h-3.5 w-3.5 shrink-0 text-stone-300" strokeWidth={2.5} />
            )}
            <span className="min-w-0">
              <span
                className={
                  c.status === 'pass'
                    ? 'text-stone-600'
                    : c.status === 'fail'
                      ? 'font-medium text-stone-700'
                      : 'text-stone-400'
                }
              >
                {c.label}
              </span>
              {c.status === 'fail' && <span className="mt-0.5 block text-[11px] text-red-600">{c.message}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
