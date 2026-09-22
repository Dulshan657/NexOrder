// The Stock lookup's state machine.
//
// ── WHY THIS IS A HOOK AND NOT A COMPONENT ──────────────────────────────────
//
// `StickyScanBar` must be the LAST CHILD of the page root with nothing rendered
// after it — `sticky` is bounded by its containing block, so a dock nested
// inside the results panel would pin to the panel's bottom and drift as the
// page scrolls. But the field and the results are one piece of state. So the
// state lives here, `StockView` renders the dock and the panel as siblings, and
// neither owns the other.
//
// ── TWO STAGES, AND THE SECOND ONE IS WHY PLATES RESOLVE AT ALL ─────────────
//
// `buildScanIndex` matches rows the caller already holds. Locations and
// products are both fully in memory, so they are free. Handling units are not:
// no query in this repo returns every plate, and indexing whichever ones happen
// to be on screen would make a plate scan resolve SOMETIMES — worse than never,
// because the operator would learn to distrust the screen rather than the data.
//
// So an index miss falls through to a point lookup on `handling_units.code`,
// which is `NOT NULL UNIQUE` with `HU-` reserved against location codes and
// SKUs. The in-flight window gets its own `resolving` screen: without it a
// plate scan shows "no match" for as long as the round trip takes, and a wrong
// answer that later corrects itself is the failure mode this whole scan path
// exists to remove — the gun's beep means a barcode decoded, never that the app
// agreed.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildScanIndex,
  resolveScan,
  type ProductMatchSource,
  type ScanLocation,
  type ScanMatch,
  type ScanProduct,
} from '@/lib/scan/resolveScan'
import { useHandlingUnitByCode, useLocations } from '@/hooks/queries/useInventoryBalances'
import { useScanFlash, type ScanVerdict } from '@/lib/scan/useScanFlash'
import type { HandlingUnitHit } from '@/services/supabase/inventoryService'
import type { Product } from '../../../types'

export type LookupScreen =
  | { kind: 'idle' }
  | { kind: 'resolving'; code: string }
  | { kind: 'location'; location: ScanLocation }
  | { kind: 'product'; product: ScanProduct; matchedOn: ProductMatchSource }
  | { kind: 'plate'; plate: HandlingUnitHit }
  | { kind: 'ambiguous'; normalized: string; candidates: readonly ScanMatch[] }
  | { kind: 'unknown'; normalized: string }

export interface StockLookupState {
  screen: LookupScreen
  code: string
  setCode: (v: string) => void
  onScan: (raw: string) => void
  /** Commits to one candidate of an ambiguous scan. Never called automatically. */
  pick: (match: ScanMatch) => void
  flash: ScanVerdict | null
  reset: () => void
}

function screenForMatch(match: ScanMatch): LookupScreen {
  if (match.kind === 'location') return { kind: 'location', location: match.location }
  if (match.kind === 'product') return { kind: 'product', product: match.product, matchedOn: match.matchedOn }
  // A handlingUnit match can only arrive from a caller that indexed plates.
  // This one does not, but the branch is real rather than a throw: the index
  // sources are a prop of the call, and a future caller adding them should get
  // the right screen, not a crash.
  return { kind: 'resolving', code: match.handlingUnit.code }
}

export function useStockLookup(products: readonly Product[]): StockLookupState {
  const [code, setCode] = useState('')
  const [screen, setScreen] = useState<LookupScreen>({ kind: 'idle' })
  const [plateCode, setPlateCode] = useState<string | null>(null)
  const { flash, signal } = useScanFlash()
  const { data: locations } = useLocations()
  const plateQuery = useHandlingUnitByCode(plateCode)

  // EVERY location, not just the scoped subtree. Scanning a bin at another site
  // must say "that one is at Northgate", not "unknown code" — and
  // `buildScanIndex` keeps inactive locations for the same reason.
  const index = useMemo(
    () =>
      buildScanIndex({
        locations: (locations ?? []).map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
          isActive: l.isActive,
        })),
        products: products.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          barcode: p.barcode ?? null,
        })),
      }),
    [locations, products],
  )

  const onScan = useCallback(
    (raw: string) => {
      const result = resolveScan(raw, index)
      if (result.kind === 'empty') return

      if (result.kind === 'unknown') {
        // Stage 2. Hold the screen at `resolving` rather than showing a miss we
        // may be about to contradict.
        setPlateCode(result.normalized)
        setScreen({ kind: 'resolving', code: result.normalized })
        return
      }

      setPlateCode(null)
      if (result.kind === 'ambiguous') {
        // Not a verdict either way — the operator still has to choose.
        setScreen({ kind: 'ambiguous', normalized: result.normalized, candidates: result.candidates })
        return
      }

      signal('ok')
      setScreen(screenForMatch(result))
    },
    [index, signal],
  )

  // Settle stage 2. `isFetching` guards against reading a stale `data` from the
  // previous plate while the new one is still in flight.
  useEffect(() => {
    if (plateCode == null || plateQuery.isFetching) return
    if (plateQuery.data) {
      signal('ok')
      setScreen({ kind: 'plate', plate: plateQuery.data })
    } else if (plateQuery.isError || plateQuery.isSuccess) {
      signal('reject')
      setScreen({ kind: 'unknown', normalized: plateCode })
    }
  }, [plateCode, plateQuery.data, plateQuery.isFetching, plateQuery.isError, plateQuery.isSuccess, signal])

  const pick = useCallback((match: ScanMatch) => {
    setPlateCode(null)
    setScreen(screenForMatch(match))
  }, [])

  const reset = useCallback(() => {
    setPlateCode(null)
    setCode('')
    setScreen({ kind: 'idle' })
  }, [])

  return { screen, code, setCode, onScan, pick, flash, reset }
}
