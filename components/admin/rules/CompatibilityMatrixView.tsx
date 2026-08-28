// Category × category compatibility grid. Click a cell to cycle its level
// (allowed → restricted → forbidden → allowed). Stored normalized (a ≤ b), so the
// grid is symmetric — editing (A,B) or (B,A) hits the same row. Used by the
// engine's putaway compatibility gate: forbidden vetoes a bin already holding the
// other category; restricted penalizes it.

import { useMemo } from 'react'
import { CATEGORIES } from '@/constants'
import { useCompatibility, useSetCompatibility, useDeleteCompatibility } from '@/hooks/queries/useWieRules'
import type { CompatibilityLevel } from '@/types'

const NEXT: Record<CompatibilityLevel, CompatibilityLevel> = {
  allowed: 'restricted',
  restricted: 'forbidden',
  forbidden: 'allowed',
}

const CELL_STYLE: Record<CompatibilityLevel, string> = {
  allowed: 'bg-emerald-50 text-emerald-600',
  restricted: 'bg-amber-100 text-amber-700',
  forbidden: 'bg-red-100 text-red-700',
}

const CELL_LABEL: Record<CompatibilityLevel, string> = { allowed: '·', restricted: '!', forbidden: '✕' }

function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`
}

export function CompatibilityMatrixView() {
  const { data: rules, isLoading } = useCompatibility()
  const setCompat = useSetCompatibility()
  const delCompat = useDeleteCompatibility()

  const levelByPair = useMemo(() => {
    const m = new Map<string, CompatibilityLevel>()
    for (const r of rules ?? []) m.set(pairKey(r.categoryA, r.categoryB), r.level)
    return m
  }, [rules])

  const cycle = (a: string, b: string) => {
    const current = levelByPair.get(pairKey(a, b)) ?? 'allowed'
    const next = NEXT[current]
    if (next === 'allowed') delCompat.mutate({ a, b })
    else setCompat.mutate({ a, b, level: next })
  }

  if (isLoading) return <p className="text-xs text-stone-500">Loading matrix…</p>

  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500">
        Click a cell to cycle: <span className="text-emerald-600">· allowed</span> →{' '}
        <span className="text-amber-700">! restricted</span> → <span className="text-red-700">✕ forbidden</span>.
      </p>
      <div className="overflow-auto">
        <table className="text-[11px] border-collapse">
          <thead>
            <tr>
              <th className="p-1 sticky left-0 bg-white" />
              {CATEGORIES.map((c) => (
                <th key={c} className="p-1 font-medium text-stone-500 whitespace-nowrap" style={{ writingMode: 'vertical-rl' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((rowCat) => (
              <tr key={rowCat}>
                <th className="p-1 text-right font-medium text-stone-500 whitespace-nowrap sticky left-0 bg-white">{rowCat}</th>
                {CATEGORIES.map((colCat) => {
                  const level = levelByPair.get(pairKey(rowCat, colCat)) ?? 'allowed'
                  const isDiag = rowCat === colCat
                  return (
                    <td key={colCat} className="p-0.5">
                      <button
                        onClick={() => cycle(rowCat, colCat)}
                        disabled={isDiag}
                        className={`w-6 h-6 rounded font-mono btn-press ${isDiag ? 'bg-stone-50 text-stone-300' : CELL_STYLE[level]}`}
                        title={`${rowCat} ↔ ${colCat}: ${level}`}
                      >
                        {isDiag ? '' : CELL_LABEL[level]}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
