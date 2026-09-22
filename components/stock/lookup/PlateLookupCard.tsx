// What's on this plate, and where it is.
//
// ── WHY THIS SCREEN EXISTS AT ALL ───────────────────────────────────────────
//
// A plate label is one of the three things in this building carrying a barcode,
// and until now scanning one outside Putaway answered "unknown code". That is
// the worst possible reply: the gun beeped, so the operator knows the label
// read, and the app is telling them the warehouse has never heard of it.
//
// "Count this bin" targets the plate's LOCATION, not the plate. Stocktake
// counts locations, and pretending otherwise would be the duplication this
// cluster is specifically avoiding. A plate still open at the dock has no
// location yet, so the button is absent and the screen says why rather than
// offering a disabled control with no explanation.

import React from 'react'
import { ClipboardList, Layers, MapPin } from 'lucide-react'
import { Callout, type CalloutTone } from '@/components/ui'
import type { HandlingUnitHit } from '@/services/supabase/inventoryService'
import { locationTitle } from '@/lib/locationDisplay'
import { LookupHeader } from './LookupHeader'

/** The wording is the migration's own (00075:62-66) — "kept for history, code
 *  never reused" is a promise the schema makes, not a phrasing choice. */
const STATUS: Record<HandlingUnitHit['status'], { tone: CalloutTone; title: string; body: string } | null> = {
  stored: null,
  open: {
    tone: 'info',
    title: 'Still being built',
    body: 'This plate is open at the dock and has not been received yet, so it holds no ledger stock.',
  },
  empty: {
    tone: 'neutral',
    title: 'Fully consumed',
    body: 'Everything on this plate has been picked or moved off. The code is kept for history and is never reused.',
  },
  cancelled: {
    tone: 'warning',
    title: 'Cancelled',
    body: 'This plate was abandoned before receipt. It should not be in circulation.',
  },
}

export interface PlateLookupCardProps {
  plate: HandlingUnitHit
  onCountBin?: (locationId: number) => void
}

export function PlateLookupCard({ plate, onCountBin }: PlateLookupCardProps) {
  const note = STATUS[plate.status]
  const place = plate.locationCode
    ? locationTitle({ code: plate.locationCode, name: plate.locationName })
    : null
  const total = plate.lines.reduce((sum, l) => sum + l.onHand, 0)

  // A plate's contents are its balance rows, and nothing forces them to share a
  // location — dev still carries plates split across two. Say so rather than
  // showing the header's single location and letting it quietly disagree.
  const splitAcross = new Set(plate.lines.map((l) => l.locationId).filter((id) => id != null)).size > 1

  return (
    <div className="space-y-4">
      <LookupHeader
        kind={plate.huType === 'pallet' ? 'Pallet' : 'Carton'}
        code={plate.code}
        name={place}
        detail={place ? 'Where it is now' : 'Not placed yet'}
        icon={<Layers className="h-5 w-5" aria-hidden="true" />}
      />

      {note && (
        <Callout tone={note.tone} dense title={note.title}>
          {note.body}
        </Callout>
      )}

      {!plate.labelPrinted && (
        <Callout tone="warning" dense title="No sticker printed">
          The system minted this plate but its label has never been printed, so the code you
          scanned came from somewhere else. Worth checking.
        </Callout>
      )}

      {splitAcross && (
        <Callout tone="warning" dense title="Split across locations">
          Stock from this plate sits in more than one place. Each line below says where.
        </Callout>
      )}

      {/* Two separate conditions, not one ternary: "no handler to hand off to"
          and "nothing to hand off" are different facts, and collapsing them
          would print the second explanation for the first cause. */}
      {plate.locationId == null ? (
        <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
          Counting happens by location, and this plate has not been placed in one yet.
        </p>
      ) : onCountBin ? (
        <button
          type="button"
          onClick={() => onCountBin(plate.locationId as number)}
          className="touch-target-y flex w-full items-center justify-center gap-2 rounded-xl bg-nexgen-blue-dark px-4 py-2.5 text-sm font-semibold text-white btn-press"
        >
          <ClipboardList className="h-4 w-4" aria-hidden="true" /> Count {place ?? 'this bin'}
        </button>
      ) : null}

      {plate.lines.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center">
          <Layers className="mx-auto mb-3 h-9 w-9 text-stone-300" aria-hidden="true" />
          <p className="text-sm text-stone-700">Nothing on it</p>
          <p className="mt-1 text-xs text-stone-600">
            No ledger stock carries this plate.
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-stone-600">
            {plate.lines.length} {plate.lines.length === 1 ? 'line' : 'lines'} · {total} units in total.
          </p>
          <ul className="glass-card divide-y divide-stone-100 overflow-hidden rounded-xl">
            {plate.lines.map((line, i) => (
              <li key={`${line.productId}-${line.batchId ?? 'nb'}-${i}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-900">{line.name}</p>
                    <p className="truncate font-mono text-xs text-stone-600">{line.sku}</p>
                  </div>
                  <p className="shrink-0 font-mono text-base font-semibold tabular-nums text-stone-900">
                    {line.onHand}
                  </p>
                </div>
                <p className="mt-1 flex items-center gap-1 text-xs text-stone-600">
                  {splitAcross && line.locationId != null && (
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">
                    {line.lotCode ? `lot ${line.lotCode}` : 'untracked'}
                    {line.expiryDate ? ` · exp ${line.expiryDate}` : ''}
                    {line.allocated > 0 ? ` · ${line.allocated} allocated` : ''}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export default PlateLookupCard
