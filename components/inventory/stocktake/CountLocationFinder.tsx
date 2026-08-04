// Choose what to count: scan a bin label, or pick a place that has no label.
//
// Two entry points, and both are necessary. Scanning is how the floor works and
// is the fast path for the racked core. But a BULK area's stock sits on the
// warehouse ROOT, and a root is not a physical shelf — there is nothing to put a
// QR sticker on. On a mixed site like Amadiya's, offering only the scanner would
// leave half the building uncountable, so the list below the scanner is not a
// fallback for convenience; it is the only way to reach a bulk area at all.

import React, { useMemo, useState } from 'react'
import { Package, ScanLine, Search } from 'lucide-react'
import { ScanField } from '@/components/ui/ScanField'
import { buildScanIndex, resolveScan, type ScanMatch } from '@/lib/scan/resolveScan'
import type { InventoryLocation } from '@/types'
import { locationSubtitle, locationTitle } from '@/lib/locationDisplay'

/** Kinds that physically hold stock. WAREHOUSE is here because a bulk site (and
 *  a racked site's unplaced goods) keep their stock on the root. ZONE/AISLE/RACK
 *  are containers — a RACK's stock lives on its SHELF levels, not on the rack
 *  row itself, so offering one would produce an always-empty sheet. */
const COUNTABLE_KINDS = new Set(['WAREHOUSE', 'BIN', 'SHELF', 'BAY', 'STAGING'])

export function isCountableLocation(loc: InventoryLocation): boolean {
  if (!loc.isActive) return false
  if (!COUNTABLE_KINDS.has(loc.kind)) return false
  // A RACK parent is kind BIN until it is split; once it has levels its stock is
  // on the SHELF rows. Levels always carry levelIndex, and a rack parent never
  // does, so nothing extra is needed here — both are individually countable.
  return true
}

interface CountLocationFinderProps {
  /** Every location in the chosen warehouse, INCLUDING the root — which
   *  `getWarehouseLocations` excludes, so the caller prepends it. */
  locations: InventoryLocation[]
  onPick: (location: InventoryLocation) => void
}

const MAX_LISTED = 40

export const CountLocationFinder: React.FC<CountLocationFinderProps> = ({ locations, onPick }) => {
  const [code, setCode] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const countable = useMemo(() => locations.filter(isCountableLocation), [locations])

  // The index carries EVERY location, not just the countable ones, so scanning
  // an aisle or rack sign can say what it actually is instead of "unknown code".
  const index = useMemo(
    () =>
      buildScanIndex({
        locations: locations.map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
          isActive: l.isActive,
        })),
      }),
    [locations],
  )

  const filtered = useMemo(() => {
    const q = code.trim().toLowerCase()
    const list = q
      ? countable.filter((l) => l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q))
      : countable
    return list.slice(0, MAX_LISTED)
  }, [code, countable])

  const handleScan = (raw: string) => {
    const result = resolveScan(raw, index)
    if (result.kind === 'empty') return

    if (result.kind === 'unknown') {
      setNote(`No location in this warehouse matches ${result.normalized}.`)
      return
    }

    const candidates: ScanMatch[] = result.kind === 'ambiguous' ? result.candidates : [result]
    const locationMatch = candidates.find((c) => c.kind === 'location')
    if (!locationMatch || locationMatch.kind !== 'location') {
      setNote('That code names a product or a pallet. Scan a bin label instead.')
      return
    }

    const target = locations.find((l) => l.id === locationMatch.location.id)
    if (!target) {
      setNote('That bin is not in the warehouse you have selected.')
      return
    }
    if (!target.isActive) {
      setNote(`${target.code} is not active, so it cannot be counted.`)
      return
    }
    if (!isCountableLocation(target)) {
      setNote(
        `${target.code} is a ${target.kind} — a container, not a place stock sits. ` +
        'Scan one of the bins or levels inside it.',
      )
      return
    }

    setNote(null)
    setCode('')
    onPick(target)
  }

  return (
    <div className="space-y-4">
      <ScanField
        label="Scan a bin label"
        value={code}
        onChange={(v) => { setCode(v); if (note) setNote(null) }}
        onScan={handleScan}
        placeholder="A bin code, or type to search"
        cameraTitle="Scan the bin you are counting"
        autoFocus
      />

      {note && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600" role="status">
          <ScanLine className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {note}
        </p>
      )}

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400">
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          {code.trim() ? 'Matching places' : 'Or pick a place to count'}
        </p>

        {filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-300 px-3 py-6 text-center text-sm text-stone-500">
            Nothing here matches. A warehouse with no published layout has only its root to count.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
            {filtered.map((loc) => (
              <li key={loc.id}>
                <button
                  type="button"
                  onClick={() => onPick(loc)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-stone-50 btn-press"
                >
                  <span className="min-w-0">
                    {/* Name first (mig 00094); this list already searched both. */}
                    <span className="block truncate text-sm text-stone-900">{locationTitle(loc)}</span>
                    {locationSubtitle(loc) && (
                      <span className="block font-mono text-xs text-stone-400">{locationSubtitle(loc)}</span>
                    )}
                  </span>
                  <span className="shrink-0 rounded bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
                    {loc.kind === 'WAREHOUSE'
                      ? 'Site root · bulk'
                      : loc.levelIndex != null ? `Level ${loc.levelIndex}` : loc.kind}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {countable.length > filtered.length && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-stone-400">
            <Package className="h-3 w-3" aria-hidden="true" />
            Showing {filtered.length} of {countable.length} — scan a label or type to narrow.
          </p>
        )}
      </div>
    </div>
  )
}
