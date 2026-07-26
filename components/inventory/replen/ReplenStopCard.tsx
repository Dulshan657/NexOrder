// One stop on the replenishment walk, confirmed by scanning.
//
// Five steps rather than putaway's four, because a replenishment has two bins:
// scan the SOURCE, scan the plate, confirm the quantity, scan the DESTINATION.
// Each catches a different error, and none is evidence of another.
//
// The two bins are treated in OPPOSITE ways, and that is the whole design (see
// _shared/replenScanCheck.ts):
//
//   * a different SOURCE is allowed — the assigned bay is often found empty or
//     blocked, and pulling from the next one along is the correct call. The card
//     warns, names both bins, and the server records where it really came from.
//   * a different DESTINATION is refused — this task exists because ONE pick
//     slot is low, and putting the stock anywhere else leaves that slot exactly
//     as short while reporting the work as done.
//
// Validation runs through the SAME pure module the Edge Function uses, so the
// browser can never accept something the server will reject. The server
// re-checks regardless; this is for instant feedback in an aisle.

import React, { useState } from 'react'
import { AlertTriangle, ArrowRight, Check, MapPin, Undo2, X, Layers } from 'lucide-react'
import { ScanField } from '@/components/ui/ScanField'
import { checkReplenScan } from '@/supabase/functions/_shared/replenScanCheck'
import { useCompleteReplenishment, useUnassignReplenishment } from '@/hooks/queries/useReplenishment'
import { useToasts } from '@/hooks/useToasts'
import { CompleteReplenError } from '@/services/supabase/replenService'
import type { ReplenRouteStop } from '@/services/supabase/replenRouteService'

interface ReplenStopCardProps {
  stop: ReplenRouteStop
  active: boolean
  disabled: boolean
  onActivate: () => void
  onDone: () => void
}

type Step = 'idle' | 'source' | 'plate' | 'qty' | 'destination'

// React.FC deliberately: this repo ships no @types/react, so a plainly-typed
// component's props do not include `key`, and the walk renders these in a list.
export const ReplenStopCard: React.FC<ReplenStopCardProps> = ({
  stop, active, disabled, onActivate, onDone,
}) => {
  const { addToast } = useToasts()
  const complete = useCompleteReplenishment()
  const unassign = useUnassignReplenishment()

  const [step, setStep] = useState<Step>('idle')
  const [fromCode, setFromCode] = useState('')
  const [plateCode, setPlateCode] = useState('')
  const [qty, setQty] = useState('')
  const [toCode, setToCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const name = stop.productName ?? `Product #${stop.productId}`
  const movedQty = qty.trim() === '' ? stop.qtyBase : Number(qty)

  const task = {
    assignedFromCode: stop.code,
    toCode: stop.toCode,
    product: { id: stop.productId, sku: stop.sku ?? '', name },
    huCode: stop.huCode,
    remainingQty: stop.qtyBase,
  }

  // Live verdict against whatever has been scanned so far, so the operator sees
  // a wrong destination the instant they scan it rather than after committing.
  const verdict = checkReplenScan(
    task,
    { fromLocationCode: fromCode, toLocationCode: toCode, handlingUnitCode: plateCode },
    movedQty > 0 ? movedQty : stop.qtyBase,
  )
  const pulledElsewhere = verdict.ok === true && verdict.pulledElsewhere

  const start = () => {
    if (disabled) return
    onActivate()
    setError(null)
    setStep('source')
  }

  const reset = () => {
    setStep('idle')
    setFromCode('')
    setPlateCode('')
    setQty('')
    setToCode('')
    setError(null)
  }

  const submit = async () => {
    if (verdict.ok === false) {
      setError(verdict.message)
      return
    }
    try {
      const result = await complete.mutateAsync({
        taskId: stop.taskId,
        quantity: qty.trim() === '' ? undefined : Number(qty),
        scan: {
          fromLocationCode: fromCode || undefined,
          toLocationCode: toCode || undefined,
          handlingUnitCode: plateCode || undefined,
        },
      })
      addToast(
        result.pulledElsewhere
          ? `Moved to ${stop.toCode} from a different bin — recorded`
          : `${stop.toCode} topped up`,
        'success',
      )
      reset()
      onDone()
    } catch (e) {
      // `reason` is a stable marker; the copy is not. Keying off it means
      // rewording a server message can never remove the operator's way forward.
      if (e instanceof CompleteReplenError) {
        setError(e.message)
        if (e.reason === 'insufficient_stock') {
          setStep('qty')
        }
        return
      }
      setError(e instanceof Error ? e.message : 'Could not complete this move')
    }
  }

  return (
    <div
      className={`rounded-xl border bg-white p-4 ${active ? 'border-nexgen-blue shadow-card' : 'border-stone-200'}`}
      data-testid={`replen-stop-${stop.taskId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {stop.reachable && (
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 tabular-nums">
                {stop.sequence}
              </span>
            )}
            <p className="text-sm font-display font-bold text-stone-900 truncate">{name}</p>
            {stop.sameNode && (
              <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                <Layers className="w-3 h-3" aria-hidden="true" /> same rack — no travel
              </span>
            )}
          </div>
          <p className="text-xs text-stone-500 font-mono mt-0.5">{stop.sku}</p>
          <p className="text-sm mt-1.5 flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-stone-700">{stop.code}</span>
            <ArrowRight className="w-3.5 h-3.5 text-stone-400" aria-hidden="true" />
            <span className="font-mono text-emerald-700 font-semibold">{stop.toCode}</span>
            <span className="text-stone-400">·</span>
            <span className="tabular-nums text-stone-700">{stop.qtyBase}</span>
            {stop.huCode && <span className="text-[11px] font-mono text-stone-400">{stop.huCode}</span>}
          </p>
          {!stop.reachable && (
            <p className="text-[11px] text-amber-700 mt-1">
              Off the map — this bin is not in the published layout, so it could not be routed.
            </p>
          )}
        </div>

        {step === 'idle' && (
          <button
            type="button"
            onClick={start}
            disabled={disabled}
            className="shrink-0 px-3 py-1.5 min-h-[44px] rounded-lg bg-nexgen-blue text-white text-sm font-semibold btn-press disabled:opacity-50"
          >
            Start
          </button>
        )}
      </div>

      {step !== 'idle' && (
        <div className="mt-4 space-y-3 border-t border-stone-100 pt-3">
          {step === 'source' && (
            <ScanField
              label="Scan the bin you are pulling from"
              value={fromCode}
              onChange={setFromCode}
              onScan={(raw) => { setFromCode(raw); setStep(stop.huCode ? 'plate' : 'qty') }}
              placeholder={stop.code}
              helper={`Assigned: ${stop.code}. A different bin is fine — it gets recorded.`}
              autoFocus
              cameraTitle="Scan source bin"
            />
          )}

          {step === 'plate' && (
            <ScanField
              label="Scan the pallet or carton label"
              value={plateCode}
              onChange={setPlateCode}
              onScan={(raw) => { setPlateCode(raw); setStep('qty') }}
              placeholder={stop.huCode ?? 'HU-000000'}
              helper={pulledElsewhere
                ? 'You pulled from a different bin, so any plate there is fine.'
                : `Expected ${stop.huCode}`}
              error={verdict.ok === false && verdict.code === 'WRONG_PLATE' ? verdict.message : undefined}
              autoFocus
              cameraTitle="Scan plate"
            />
          )}

          {step === 'qty' && (
            <div>
              <label className="block text-xs text-stone-500">
                How much are you moving?
                <input
                  type="number"
                  min={1}
                  max={stop.qtyBase}
                  autoFocus
                  value={qty}
                  placeholder={String(stop.qtyBase)}
                  onChange={(e) => setQty(e.target.value)}
                  className="mt-1 w-full text-sm rounded-lg border border-stone-200 px-3 py-2 min-h-[44px]"
                />
              </label>
              <p className="text-[11px] text-stone-400 mt-1">
                Leave blank to move all {stop.qtyBase}. Moving less leaves the rest on the queue.
              </p>
              <button
                type="button"
                onClick={() => setStep('destination')}
                className="mt-2 px-3 py-1.5 min-h-[44px] rounded-lg border border-stone-200 text-sm btn-press"
              >
                Next — scan the pick zone
              </button>
            </div>
          )}

          {step === 'destination' && (
            <ScanField
              label="Scan the pick zone you are placing into"
              value={toCode}
              onChange={setToCode}
              onScan={(raw) => setToCode(raw)}
              placeholder={stop.toCode}
              helper={`This top-up refills ${stop.toCode}.`}
              error={verdict.ok === false && verdict.code === 'WRONG_DESTINATION' ? verdict.message : undefined}
              autoFocus
              cameraTitle="Scan pick zone"
            />
          )}

          {pulledElsewhere && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-amber-900">
                You scanned <span className="font-mono">{fromCode}</span>, not{' '}
                <span className="font-mono">{stop.code}</span>. That is allowed — it will be recorded as
                where the stock actually came from.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 flex gap-2">
              <X className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-red-900">{error}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={complete.isPending || step !== 'destination' || !toCode}
              className="px-3 py-1.5 min-h-[44px] rounded-lg bg-emerald-600 text-white text-sm font-semibold btn-press disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" aria-hidden="true" />
              {complete.isPending ? 'Moving…' : 'Confirm the move'}
            </button>
            <button
              type="button"
              onClick={reset}
              className="px-3 py-1.5 min-h-[44px] rounded-lg border border-stone-200 text-sm btn-press"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => unassign.mutateAsync({ taskId: stop.taskId })
                .then(() => { reset(); onDone() })
                .catch((e) => setError(e instanceof Error ? e.message : 'Could not put it back'))}
              disabled={unassign.isPending}
              className="ml-auto text-xs text-stone-500 hover:text-stone-700 btn-press inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
              Can't do this one — put it back
            </button>
          </div>
        </div>
      )}

      {step === 'idle' && stop.reachable && (stop.legDistanceM > 0 || stop.placeLegM > 0) && (
        <p className="mt-2 text-[11px] text-stone-400 flex items-center gap-1">
          <MapPin className="w-3 h-3" aria-hidden="true" />
          {Math.round(stop.legDistanceM)} m to the bin
          {stop.placeLegM > 0 && <> · {Math.round(stop.placeLegM)} m to the pick zone</>}
        </p>
      )}
    </div>
  )
}

export default ReplenStopCard
