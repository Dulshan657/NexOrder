// Break a pallet down, at the rack, mid-walk.
//
// Three steps, and the order is the operator's, not the data's:
//
//   1. Scan the plate. Same evidence the stop card demands before anything
//      else happens — you cannot break down a pallet you are not holding.
//   2. Say what comes off, and where. Each row is a quantity in a unit the
//      floor actually talks in, plus a destination the engine has suggested
//      and the operator confirms.
//   3. Print the stickers. The plates exist in the ledger the moment step 2
//      commits; they exist on the floor when someone puts a label on them.
//
// NOTHING MOVES TO A BAY HERE. Each portion becomes its own assigned task and
// its own stop on this same walk, completed with the ordinary plate + bin scan.
// That is what keeps the ledger honest about where goods are, and it is what
// verifies the sticker went onto the right stack.
//
// Every total and every refusal on this sheet comes from `planBreakdown` in
// lib/palletBreakdown — the same module `break-down-putaway` runs before it
// writes. The sheet is not predicting the server's answer, it is computing it.

import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Layers, Plus, Printer, ScanLine, Trash2 } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { ScanField } from '@/components/ui/ScanField'
import { useScanFlash } from '@/lib/scan/useScanFlash'
import { checkPutawayScan } from '@/supabase/functions/_shared/putawayScanCheck'
import { useSettings } from '@/hooks/queries/useSettings'
import { useWarehouseLocations } from '@/hooks/queries/useWarehouseLocations'
import { useToasts } from '@/hooks/useToasts'
import {
  useBreakDownPallet,
  usePlanBreakdown,
  usePrintPlateLabels,
} from '@/hooks/queries/usePalletBreakdown'
import { BreakdownError, type BrokenPlate } from '@/services/supabase/palletBreakdownService'
import { COUNTED_UNITS, layerBaseQty, parsePortionCount, planBreakdown, unitLabel } from '@/lib/palletBreakdown'
import type { CountedUnit } from '@/lib/palletBreakdown'
import { palletSpecFromSettings, cartonUomOfProduct } from '@/lib/palletUom'
import { resolvePalletFit } from '@/lib/palletFit'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import { BinPickerSheet } from './BinPickerSheet'
import { baseUnitLabel, trimNumber, uomsForProduct } from './putawayFormat'

interface PalletBreakdownSheetProps {
  open: boolean
  warehouseId: number
  row: PendingPutawayRow
  onClose: () => void
  /** Fired once the break-down has committed and the operator is done. The walk
   *  re-reads its stops; this task may have vanished entirely. */
  onDone: () => void
}

interface PortionDraft {
  key: number
  unit: CountedUnit
  count: string
  locationId: number | null
  locationCode: string | null
  /** The bin the engine suggested for THIS portion, scored as the container it
   *  will become — not inherited from the pallet's own recommendation. */
  suggestedLocationId: number | null
  suggestedLocationCode: string | null
  /** The engine has ANSWERED on this row. Distinct from a non-null
   *  `suggestedLocationId`, because "no bin" is an answer and the operator has
   *  to be told it — otherwise pressing Suggest bins visibly does nothing and
   *  there is no way from inside the UI to find out why. */
  suggested: boolean
  roleOverride: boolean
}

let nextKey = 1
const emptyPortion = (unit: CountedUnit): PortionDraft => ({
  key: nextKey++,
  unit,
  count: '',
  locationId: null,
  locationCode: null,
  suggestedLocationId: null,
  suggestedLocationCode: null,
  suggested: false,
  roleOverride: false,
})

type Step = 'plate' | 'portions' | 'labels'

export const PalletBreakdownSheet: React.FC<PalletBreakdownSheetProps> = ({
  open, warehouseId, row, onClose, onDone,
}) => {
  const { addToast } = useToasts()
  const { data: settingsRow } = useSettings()
  const { data: locations = [] } = useWarehouseLocations(warehouseId)
  const plan = usePlanBreakdown()
  const commit = useBreakDownPallet()
  const print = usePrintPlateLabels()

  const [step, setStep] = useState<Step>('plate')
  const [plateCode, setPlateCode] = useState('')
  const { flash, signal: signalFlash } = useScanFlash()
  const [portions, setPortions] = useState<PortionDraft[]>([])
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [roleGate, setRoleGate] = useState<string | null>(null)
  const [plates, setPlates] = useState<BrokenPlate[]>([])
  const [labelUrl, setLabelUrl] = useState<string | null>(null)

  const product = row.product
  const baseLabel = baseUnitLabel(product)

  // ── What a unit is worth, in base units ───────────────────────────────────
  const uoms = useMemo(() => uomsForProduct(product), [product])
  const cartonFactor = useMemo(() => {
    const carton = uoms.find((u) => !u.isBase && Number(u.factorToBase) > 1)
    return carton ? Number(carton.factorToBase) : null
  }, [uoms])

  // Layers exist only when the pallet geometry does. Mig 00125 refuses by name
  // rather than inventing a figure, and so does this: the unit is withheld from
  // the picker entirely instead of being offered and computing nothing.
  const palletBasis = useMemo(() => {
    const spec = palletSpecFromSettings(settingsRow)
    const carton = cartonUomOfProduct(product)
    const unitsPerCarton = carton ? Number(carton.factorToBase) : null
    const res = resolvePalletFit({
      spec,
      cartonCm: {
        lengthCm: product?.cartonLengthCm ?? null,
        widthCm: product?.cartonWidthCm ?? null,
        heightCm: product?.cartonHeightCm ?? null,
      },
      unitCm: {
        lengthCm: product?.lengthCm ?? null,
        widthCm: product?.widthCm ?? null,
        heightCm: product?.heightCm ?? null,
      },
      unitsPerCarton: unitsPerCarton != null && Number.isInteger(unitsPerCarton) ? unitsPerCarton : null,
    })
    if (!res.ok) return null
    return { perLayer: res.fit.perLayer, unitsPerCarton: res.fit.unitsPerCarton, basis: res.fit.basis }
  }, [settingsRow, product])

  // What a layer is worth, said out loud. An estimated one is a GUESS, and this
  // is the screen where a guess turns into stock — so the caveat rides beside
  // the figure rather than being left in the product form where nobody standing
  // at a rack will read it.
  const layerNote = useMemo(() => {
    if (!palletBasis) return null
    const base = `${palletBasis.perLayer} cartons per layer`
    return palletBasis.basis === 'estimated'
      ? `${base}, estimated from the unit box — check it against the pallet.`
      : `${base}, from the measured carton.`
  }, [palletBasis])

  const availableUnits = useMemo(
    () => COUNTED_UNITS.filter((u) => {
      if (u === 'layer') return palletBasis != null
      if (u === 'carton') return cartonFactor != null
      // A whole pallet coming off a pallet is the operator moving the load onto
      // a fresh base — legal, and the only way to re-plate without splitting.
      return true
    }),
    [palletBasis, cartonFactor],
  )

  const baseQtyFor = (draft: PortionDraft): number | null => {
    const count = parsePortionCount(draft.count)
    if (count == null) return null
    if (draft.unit === 'base') return count
    if (draft.unit === 'carton') return cartonFactor != null ? count * cartonFactor : null
    if (draft.unit === 'layer') return layerBaseQty(count, palletBasis)
    // A "pallet" portion is whatever is left standing on one — there is no
    // factor for it, so it is the parent's own quantity times the count.
    return count * row.quantity
  }

  const planned = useMemo(
    () => planBreakdown({
      parentQty: row.quantity,
      portions: portions.map((p) => ({
        baseQty: baseQtyFor(p) ?? 0,
        countedUnit: p.unit,
        locationId: p.locationId,
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [portions, row.quantity, cartonFactor, palletBasis],
  )

  const dirty = portions.length > 0 && step !== 'labels'

  useEffect(() => {
    if (!open) {
      setStep('plate')
      setPlateCode('')
      setPortions([])
      setPickerFor(null)
      setError(null)
      setRoleGate(null)
      setPlates([])
      setLabelUrl(null)
    }
  }, [open])

  const scanContext = useMemo(
    () => ({
      assignedLocationCode: '',
      product: {
        id: row.productId,
        sku: product?.sku ?? '',
        name: product?.name ?? `Product #${row.productId}`,
        barcode: product?.barcode ?? null,
      },
      huCode: row.huCode,
      remainingQty: row.quantity,
    }),
    [row.productId, row.huCode, row.quantity, product?.sku, product?.name, product?.barcode],
  )

  const onPlateScan = (raw: string) => {
    const verdict = checkPutawayScan(scanContext, { handlingUnitCode: raw }, row.quantity)
    if (verdict.ok === false) {
      setError(verdict.message)
      setPlateCode('')
      signalFlash('reject')
      return
    }
    setError(null)
    signalFlash('ok')
    setPortions([emptyPortion(availableUnits.includes('carton') ? 'carton' : 'base')])
    setStep('portions')
  }

  const patch = (key: number, next: Partial<PortionDraft>) => {
    // Changing the quantity or the unit invalidates the engine's answer for
    // this row: a "no bin" verdict for 6 cartons says nothing about 2, and a
    // stale one shown against a number nobody scored is worse than silence.
    const restated = next.count !== undefined || next.unit !== undefined
    setPortions((prev) => prev.map((p) => (
      p.key === key
        ? { ...p, ...next, ...(restated ? { suggested: false, suggestedLocationId: null, suggestedLocationCode: null } : {}) }
        : p
    )))
    setError(null)
  }

  // ── Ask the engine where each portion should go ───────────────────────────
  // One call for the whole sheet, not one per row: the server folds each
  // allocation into a greedy overlay, so two carton portions cannot both be
  // sent to the same pick bay.
  const suggest = async () => {
    const rows = portions.map((p) => ({
      baseQty: baseQtyFor(p) ?? 0,
      countedUnit: p.unit,
      locationId: p.locationId,
    }))
    if (rows.some((r) => r.baseQty <= 0)) {
      setError('Every portion needs a quantity before the engine can suggest a bin.')
      return
    }
    try {
      const result = await plan.mutateAsync({ recommendationId: row.id, portions: rows })
      setPortions((prev) => prev.map((p, i) => {
        const suggestion = result.portions[i]
        if (!suggestion) return p
        const code = locations.find((l) => l.id === suggestion.recommendedLocationId)?.code ?? null
        return {
          ...p,
          suggested: true,
          suggestedLocationId: suggestion.recommendedLocationId,
          suggestedLocationCode: code,
          // Only fill a destination nobody has chosen yet — never overwrite one
          // the operator has already picked.
          locationId: p.locationId ?? suggestion.recommendedLocationId,
          locationCode: p.locationCode ?? code,
        }
      }))
      if (result.mode === 'legacy') {
        addToast('This site has no published layout — choose the bins yourself', 'info')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not plan that break-down')
    }
  }

  const confirm = async (roleOverride = false) => {
    if (!planned.ok) {
      setError(planned.message)
      return
    }
    try {
      const result = await commit.mutateAsync({
        recommendationId: row.id,
        portions: portions.map((p) => ({
          baseQty: baseQtyFor(p) as number,
          countedUnit: p.unit,
          locationId: p.locationId,
        })),
        roleOverride: roleOverride || portions.some((p) => p.roleOverride) || undefined,
      })
      setPlates(result.plates)
      setRoleGate(null)
      setError(null)
      setStep('labels')
      addToast(
        result.parentClosed
          ? `Broken into ${result.plates.length} plates — the pallet is empty`
          : `Broken into ${result.plates.length} plates — ${trimNumber(result.parentRemaining)} stays on the pallet`,
        'success',
      )
    } catch (e) {
      if (e instanceof BreakdownError && e.reason === 'level_role_mismatch') {
        setRoleGate(e.message)
        setError(null)
        return
      }
      setError(e instanceof Error ? e.message : 'Could not break this pallet down')
    }
  }

  const renderLabels = async () => {
    try {
      const result = await print.mutateAsync(plates.map((p) => p.handlingUnitId))
      // The URL is rendered as a link the operator TAPS. Calling window.open
      // here — after an await — is popup-blocked, every time.
      setLabelUrl(result.signedUrl)
      if (!result.signedUrl) addToast('The sheet rendered but returned no link — try again', 'error')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not render the labels', 'error')
    }
  }

  const pickerRow = pickerFor != null ? portions.find((p) => p.key === pickerFor) : undefined

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Break this pallet down"
        icon={<Layers className="w-5 h-5" aria-hidden="true" />}
        description={
          step === 'labels'
            ? 'Put a label on each new plate before you carry it.'
            : 'Each portion becomes its own plate and its own stop on this walk.'
        }
        mobile="full"
        dirty={dirty}
        discardConfirm={{
          title: 'Discard this break-down?',
          message: 'Nothing has been committed yet — the pallet stays whole.',
          confirmLabel: 'Discard',
        }}
        footer={({ requestClose }) => (
          <div className="flex items-center gap-2 w-full">
            <button
              type="button"
              onClick={requestClose}
              className="px-3 py-2 min-h-[44px] text-sm text-stone-600 hover:text-stone-900 btn-press"
            >
              {step === 'labels' ? 'Close' : 'Cancel'}
            </button>
            {step === 'portions' && (
              <button
                type="button"
                onClick={() => confirm(false)}
                disabled={!planned.ok || commit.isPending}
                className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] bg-emerald-600 text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
              >
                <Layers className="w-4 h-4" aria-hidden="true" />
                {commit.isPending ? 'Breaking down…' : `Break into ${portions.length} plate${portions.length === 1 ? '' : 's'}`}
              </button>
            )}
            {step === 'labels' && (
              <button
                type="button"
                onClick={() => { onDone(); onClose() }}
                className="ml-auto px-3.5 py-2 min-h-[44px] bg-nexgen-blue text-white text-sm font-medium rounded-lg btn-press"
              >
                Back to the walk
              </button>
            )}
          </div>
        )}
      >
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-stone-50 border border-stone-200">
            <p className="text-sm font-medium text-stone-900 truncate">
              {product?.name ?? `Product #${row.productId}`}
            </p>
            <p className="text-xs text-stone-500">
              <span className="tabular-nums">{trimNumber(row.quantity)} {baseLabel}</span>
              {row.huCode && <span className="font-mono"> · {row.huCode}</span>}
            </p>
          </div>

          {step === 'plate' && (
            <ScanField
              label={`Scan the pallet — expecting ${row.huCode ?? ''}`}
              value={plateCode}
              onChange={setPlateCode}
              onScan={onPlateScan}
              flash={flash}
              placeholder={row.huCode ?? ''}
              cameraTitle="Scan the plate label"
              autoFocus
              helper="You cannot break down a pallet you are not holding."
              error={error ?? undefined}
            />
          )}

          {step === 'portions' && (
            <div className="space-y-3">
              {portions.map((p, index) => {
                const baseQty = baseQtyFor(p)
                return (
                  <div key={p.key} className="p-3 rounded-lg border border-stone-200 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-wide text-stone-500">
                        Portion {index + 1}
                      </span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500">
                        becomes a {p.unit === 'pallet' || p.unit === 'layer' ? 'pallet' : 'carton'} plate
                      </span>
                      {portions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setPortions((prev) => prev.filter((x) => x.key !== p.key))}
                          className="ml-auto p-1.5 text-stone-500 hover:text-red-600 rounded btn-press"
                          aria-label={`Remove portion ${index + 1}`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={p.count}
                        onChange={(e) => patch(p.key, { count: e.target.value })}
                        className="w-24 px-3 py-2 min-h-[44px] rounded-lg border border-stone-300 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
                        aria-label={`Portion ${index + 1} quantity`}
                      />
                      <select
                        value={p.unit}
                        onChange={(e) => patch(p.key, { unit: e.target.value as CountedUnit })}
                        className="px-3 py-2 min-h-[44px] rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
                        aria-label={`Portion ${index + 1} unit`}
                      >
                        {availableUnits.map((u) => (
                          <option key={u} value={u}>{unitLabel(u, baseLabel)}</option>
                        ))}
                      </select>
                      {baseQty != null && baseQty > 0 && (
                        <span className="text-xs text-stone-500 tabular-nums">
                          = {trimNumber(baseQty)} {baseLabel}
                        </span>
                      )}
                    </div>

                    {p.unit === 'layer' && layerNote && (
                      <p className={`text-[11px] ${palletBasis?.basis === 'estimated' ? 'text-amber-700' : 'text-stone-500'}`}>
                        {layerNote}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => setPickerFor(p.key)}
                      className="flex items-center gap-2 w-full px-3 py-2 min-h-[44px] rounded-lg border border-stone-200 text-left btn-press hover:bg-stone-50"
                    >
                      <ScanLine className="w-4 h-4 text-stone-500 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        {p.locationCode ? (
                          <span className="block text-sm font-mono text-stone-800 truncate">{p.locationCode}</span>
                        ) : (
                          <span className="block text-sm text-stone-500">Choose a bin</span>
                        )}
                        {p.suggestedLocationCode && p.suggestedLocationId !== p.locationId && (
                          <span className="block text-[11px] text-stone-500">
                            engine suggested <span className="font-mono">{p.suggestedLocationCode}</span>
                          </span>
                        )}
                        {p.suggested && p.suggestedLocationId == null && (
                          <span className="block text-[11px] text-amber-700">
                            No bin the engine will offer for this — pick one yourself.
                          </span>
                        )}
                      </span>
                    </button>
                  </div>
                )
              })}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setPortions((prev) => [...prev, emptyPortion(prev[prev.length - 1]?.unit ?? 'carton')])}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] text-sm text-nexgen-blue rounded-lg btn-press hover:bg-nexgen-blue/5"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Add a portion
                </button>
                <button
                  type="button"
                  onClick={suggest}
                  disabled={plan.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] text-sm text-stone-600 border border-stone-200 rounded-lg btn-press disabled:opacity-50"
                >
                  {plan.isPending ? 'Asking the engine…' : 'Suggest bins'}
                </button>
              </div>

              {/* The running total, straight off the shared planner. */}
              <div className="p-3 rounded-lg bg-stone-50 border border-stone-200 text-sm">
                <p className="tabular-nums text-stone-700">
                  {trimNumber(planned.allocated)} of {trimNumber(row.quantity)} {baseLabel} allocated
                </p>
                <p className={`text-xs tabular-nums ${planned.remainder < 0 ? 'text-red-600' : 'text-stone-500'}`}>
                  {planned.remainder < 0
                    ? `${trimNumber(-planned.remainder)} ${baseLabel} more than the pallet holds`
                    : planned.parentEmptied
                      ? 'Nothing stays on the pallet — it will be emptied'
                      : `${trimNumber(planned.remainder)} ${baseLabel} stays on the pallet`}
                </p>
              </div>

              {!planned.ok && planned.message && (
                <p className="text-xs text-amber-700">{planned.message}</p>
              )}

              {roleGate && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="text-xs space-y-2">
                    <p>{roleGate}</p>
                    <button
                      type="button"
                      onClick={() => confirm(true)}
                      disabled={commit.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] bg-amber-600 text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
                    >
                      Place anyway
                    </button>
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
            </div>
          )}

          {step === 'labels' && (
            <div className="space-y-3">
              <ul className="divide-y divide-stone-100 border border-stone-200 rounded-lg">
                {plates.map((p) => (
                  <li key={p.handlingUnitId} className="flex items-center gap-3 px-3 py-2">
                    <span className="font-mono text-sm text-stone-800">{p.code}</span>
                    <span className="text-xs text-stone-500 tabular-nums">
                      {trimNumber(p.quantity)} {baseLabel}
                    </span>
                    <span className="ml-auto text-xs font-mono text-emerald-600 truncate">
                      {p.locationCode ?? `#${p.locationId}`}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="text-xs text-stone-500">
                These plates now hold the stock, but nothing has moved yet — each one is a stop on
                this walk. Label them before you carry them, or the bin scan at the stop will have
                nothing to check against.
              </p>

              {labelUrl ? (
                // A LINK, not window.open: a programmatic open after an await is
                // popup-blocked on every browser this runs on.
                <a
                  href={labelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] bg-nexgen-blue text-white text-sm font-medium rounded-lg btn-press"
                >
                  <Printer className="w-4 h-4" aria-hidden="true" />
                  Open the label sheet
                </a>
              ) : (
                <button
                  type="button"
                  onClick={renderLabels}
                  disabled={print.isPending}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] bg-nexgen-blue text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
                >
                  <Printer className="w-4 h-4" aria-hidden="true" />
                  {print.isPending ? 'Rendering…' : `Print ${plates.length} label${plates.length === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          )}
        </div>
      </Sheet>

      {/* The destination picker is the one the Assign queue already uses: engine
          runner-ups as chips, warehouse search, a scan field, and the level-role
          warning. A Sheet over a Sheet is fine — overlayStack owns the z-index
          and Escape closes only the topmost. */}
      {pickerRow && (
        <BinPickerSheet
          open
          warehouseId={warehouseId}
          row={{ ...row, quantity: baseQtyFor(pickerRow) ?? row.quantity }}
          onClose={() => setPickerFor(null)}
          onConfirm={(chosenLocationId, _baseQty, roleOverride) => {
            const code = locations.find((l) => l.id === chosenLocationId)?.code ?? null
            patch(pickerRow.key, { locationId: chosenLocationId, locationCode: code, roleOverride })
            setPickerFor(null)
          }}
        />
      )}
    </>
  )
}
