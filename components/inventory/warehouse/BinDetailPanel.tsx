// Detail for the currently-selected location: metadata, fill, and the per-product
// contents table (the source of truth for multi-product bins that the velocity
// overlay only summarizes). Read-only.

import { PackageSearch } from 'lucide-react'
import type { InventoryLocation, LayoutPlacement, VelocityClass } from '@/types'
import type { BinContentRow } from './useWarehouseViewerModel'

interface BinDetailPanelProps {
  location: InventoryLocation | null
  contents: BinContentRow[]
  fillPct: number | null | undefined
  placement?: LayoutPlacement
  nodeVisits?: number
  zoneName?: string
}

const CLASS_TONE: Record<VelocityClass, string> = {
  A: 'bg-rose-100 text-rose-700',
  B: 'bg-amber-100 text-amber-700',
  C: 'bg-sky-100 text-sky-700',
}

export function BinDetailPanel({
  location,
  contents,
  fillPct,
  placement,
  nodeVisits,
  zoneName,
}: BinDetailPanelProps) {
  if (!location) {
    return (
      <div className="glass-card rounded-xl p-6 text-center">
        <PackageSearch className="mx-auto mb-2 h-7 w-7 text-stone-300" />
        <p className="text-xs text-stone-500">Select a rack on the map or tree to see its contents.</p>
      </div>
    )
  }

  const isBin = location.kind === 'BIN'
  const totalSlots = contents.reduce((s, r) => s + r.slots, 0)

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold text-stone-900">{location.code}</p>
          <p className="text-xs text-stone-500">{location.name}</p>
        </div>
        <span className="rounded bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
          {location.kind}
        </span>
      </div>

      <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {isBin && (
          <>
            <dt className="text-stone-400">Capacity</dt>
            <dd className="text-stone-700">
              {location.capacitySlots != null ? `${location.capacitySlots} ${location.slotKind ?? 'slots'}` : '—'}
            </dd>
            <dt className="text-stone-400">Fill</dt>
            <dd className="text-stone-700">{fillPct == null ? '—' : `${Math.round(fillPct * 100)}% (${totalSlots.toFixed(0)} used)`}</dd>
          </>
        )}
        {zoneName && (
          <>
            <dt className="text-stone-400">Zone</dt>
            <dd className="text-stone-700">{zoneName}</dd>
          </>
        )}
        {placement && (
          <>
            <dt className="text-stone-400">Position</dt>
            <dd className="text-stone-700 font-mono">F{placement.floor + 1} · {placement.x},{placement.y}</dd>
          </>
        )}
        {nodeVisits != null && (
          <>
            <dt className="text-stone-400">Pick visits (30d)</dt>
            <dd className="text-stone-700">{nodeVisits}</dd>
          </>
        )}
      </dl>

      {isBin && (
        contents.length === 0 ? (
          <p className="rounded-lg bg-stone-50 py-3 text-center text-xs text-stone-400">Empty rack</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-stone-100">
            <table className="w-full text-xs">
              <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">Product</th>
                  <th className="px-2 py-1.5 text-right font-semibold">On hand</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Alloc</th>
                  <th className="px-2 py-1.5 text-center font-semibold">ABC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {contents.map((r) => (
                  <tr key={r.productId}>
                    <td className="px-2 py-1.5 text-stone-700">{r.productName ?? `#${r.productId}`}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-stone-700">{r.onHand}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-stone-400">{r.allocated}</td>
                    <td className="px-2 py-1.5 text-center">
                      {r.velocityClass ? (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${CLASS_TONE[r.velocityClass]}`}>
                          {r.velocityClass}
                        </span>
                      ) : (
                        <span className="text-stone-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
