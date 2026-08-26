// "What's in my hands?" — scan a plate, a carton or a bin label and jump to the
// putaway line it belongs to.
//
// This is the first consumer of lib/scan/resolveScan, which was built to answer
// exactly this question and had no screen until now. Everything it needs is
// ALREADY on the client: the queue rows carry their plate code, their product's
// SKU and barcode, and the warehouse's locations are loaded for the bin codes.
// So finding a line by scanning costs no extra query — it is a lookup over data
// the screen has already fetched.
//
// The resolver checks every namespace rather than stopping at the first hit, so
// a code that could name two things comes back `ambiguous` and this component
// picks the candidate that actually matches queued work. If none do, it says the
// code is unknown TO THIS QUEUE, which is a different and more useful statement
// than "unknown code".

import React, { useMemo, useState } from 'react'
import { ScanLine } from 'lucide-react'
import { ScanField } from '@/components/ui/ScanField'
import { useScanFlash } from '@/lib/scan/useScanFlash'
import { useWedgeScanner } from '@/lib/scan/useWedgeScanner'
import { buildScanIndex, resolveScan, type ScanMatch } from '@/lib/scan/resolveScan'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { InventoryLocation } from '@/types'

interface PutawayScanFinderProps {
  rows: PendingPutawayRow[]
  locations: InventoryLocation[]
  /** Which bin a row is destined for — the assigned bin on the walk, the
   *  engine's recommendation on the assign queue. */
  binIdOf: (row: PendingPutawayRow) => number | null
  /** Exactly one line matched: open it. */
  onFound: (recommendationId: number) => void
  /** Several lines matched (or none): narrow the list instead. */
  onFilter: (text: string) => void
  label?: string
}

export const PutawayScanFinder: React.FC<PutawayScanFinderProps> = ({
  rows, locations, binIdOf, onFound, onFilter, label = 'Scan a plate, carton or bin',
}) => {
  const [code, setCode] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const { flash, signal: signalFlash } = useScanFlash()

  const index = useMemo(
    () =>
      buildScanIndex({
        locations: locations.map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
          isActive: l.isActive,
        })),
        products: rows
          .filter((r) => r.product)
          .map((r) => ({
            id: r.productId,
            sku: r.product!.sku,
            name: r.product!.name,
            barcode: r.product!.barcode ?? null,
          })),
        handlingUnits: rows
          .filter((r) => r.huId != null && r.huCode)
          .map((r) => ({ id: r.huId as number, code: r.huCode as string })),
      }),
    [rows, locations],
  )

  /** Rows a single resolved match points at. Empty means "nothing queued". */
  const rowsFor = (match: ScanMatch): PendingPutawayRow[] => {
    if (match.kind === 'handlingUnit') {
      return rows.filter((r) => r.huId === match.handlingUnit.id)
    }
    if (match.kind === 'product') {
      return rows.filter((r) => r.productId === match.product.id)
    }
    return rows.filter((r) => binIdOf(r) === match.location.id)
  }

  const describe = (match: ScanMatch): string =>
    match.kind === 'handlingUnit'
      ? `plate ${match.handlingUnit.code}`
      : match.kind === 'product'
        ? match.product.name
        : `bin ${match.location.code}`

  const handleScan = (raw: string) => {
    const result = resolveScan(raw, index)

    if (result.kind === 'empty') return

    if (result.kind === 'unknown') {
      setNote(`Nothing here matches ${result.normalized}.`)
      onFilter('')
      signalFlash('reject')
      return
    }

    // Ambiguous: one string, several possible meanings. Prefer whichever
    // candidate names actual queued work — that resolves nearly every real
    // collision without asking the operator anything.
    const candidates: ScanMatch[] = result.kind === 'ambiguous' ? result.candidates : [result]
    const hit = candidates.map((c) => ({ c, matched: rowsFor(c) })).find((x) => x.matched.length > 0)

    if (!hit) {
      const what = candidates.map(describe).join(' or ')
      setNote(`That's ${what}, but nothing here is waiting on it.`)
      onFilter('')
      signalFlash('reject')
      return
    }

    if (hit.matched.length === 1) {
      setNote(null)
      setCode('')
      signalFlash('ok')
      onFound(hit.matched[0].id)
      return
    }

    // Several lines share the plate (a mixed pallet) or the SKU. Narrow rather
    // than guessing which one the operator means.
    // Narrowing IS progress — the code was recognised and the queue moved. It
    // is not the refusal tone, which would say the label was no good.
    signalFlash('ok')
    setNote(`${hit.matched.length} lines on ${describe(hit.c)}.`)
    onFilter(
      hit.c.kind === 'handlingUnit'
        ? hit.c.handlingUnit.code
        : hit.c.kind === 'product'
          ? hit.c.product.sku
          : hit.c.location.code,
    )
  }

  // Desktop safety net — see useWedgeScanner. The finder is the right place to
  // arm it: its handler already knows how to deal with a plate, a SKU or a bin.
  //
  // This used to say the finder "is on screen for the whole walk", and used that
  // as the justification. It was false at 360x664 — two or three stop cards
  // pushed it out of view — and it mattered more than it looks, because on the
  // RS35's `Input Method` mode this net catches NOTHING (an Android IME types
  // only into the focused editable; register O2). So the handheld depends on the
  // field itself being reachable, not on this.
  //
  // Both call sites now wrap the finder in `StickyScanBar`, which is what makes
  // the claim true rather than assumed.
  useWedgeScanner({ active: true, onScan: handleScan })

  return (
    <div>
      <ScanField
        label={label}
        value={code}
        onChange={(v) => { setCode(v); if (note) setNote(null) }}
        onScan={handleScan}
        flash={flash}
        placeholder="HU-000123, a SKU, or a bin code"
        cameraTitle="Scan to find the line"
      />
      {note && (
        <p className="mt-1.5 text-xs text-amber-600 flex items-center gap-1.5" role="status">
          <ScanLine className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {note}
        </p>
      )}
    </div>
  )
}
