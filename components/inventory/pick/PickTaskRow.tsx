// One directed, per-bin pick task, confirmed by scanning.
//
// The flow is deliberately three explicit steps — scan the bin, scan the item,
// confirm the count — because they catch three different errors: being at the
// wrong bay, taking the wrong SKU off the right bay, and miscounting. The
// middle one is the most common and the most expensive, which is why a bin scan
// alone does not count as verified.
//
// Validation runs through the SAME pure module the Edge Function uses
// (_shared/pickScanCheck), so the browser can never accept something the server
// will reject, or vice versa. The server re-checks regardless — this is for
// instant feedback at the rack face, not for security.

import React, { useMemo, useState } from 'react'
import { Check, MapPin, PackageCheck, ScanLine, X } from 'lucide-react'
import { ScanField } from '@/components/ui/ScanField'
import { useScanFlash } from '@/lib/scan/useScanFlash'
import { checkPickScan } from '@/supabase/functions/_shared/pickScanCheck'
import { useRecordPick } from '@/hooks/queries/usePickQueue'
import { useToasts } from '@/hooks/useToasts'
import type { PickQueueLine, PickTask } from '@/services/supabase/pickService'
import { locationOneLine, locationSubtitle, locationTitle } from '@/lib/locationDisplay'

interface PickTaskRowProps {
  orderId: string
  task: PickTask
  line: PickQueueLine
  disabled: boolean
  /** Friendly name for the bin (mig 00094). Resolved by the queue via
   *  useLocationNames — the pick path is ORDER-scoped, so it has no warehouse
   *  locations query to read from. Absent falls back to the code. */
  binName?: string | null
}

type Step = 'idle' | 'bin' | 'item' | 'qty'

// React.FC deliberately: this repo ships no @types/react, so a plainly-typed
// function component's props interface does not include `key`, and callers
// rendering it in a list fail to type-check. Same reason the rest of the
// codebase uses React.FC. (See the types gotcha in CLAUDE.md.)
export const PickTaskRow: React.FC<PickTaskRowProps> = ({ orderId, task, line, disabled, binName }) => {
  const bin = { code: task.code, name: binName ?? null }
  const { addToast } = useToasts()
  const recordPick = useRecordPick()

  const [step, setStep] = useState<Step>('idle')
  const { flash, signal: signalFlash } = useScanFlash()
  const [binCode, setBinCode] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)

  const context = useMemo(
    () => ({
      taskLocationCode: task.code,
      product: {
        id: line.productId,
        sku: line.productSku,
        name: line.productName,
        barcode: line.productBarcode,
      },
      remainingQty: task.remaining,
    }),
    [task.code, task.remaining, line.productId, line.productSku, line.productName, line.productBarcode],
  )

  const reset = () => {
    setStep('idle')
    setBinCode('')
    setItemCode('')
    setQty('')
    setError(null)
  }

  const start = () => {
    setError(null)
    setQty(String(task.remaining))
    setStep('bin')
  }

  const onBinScan = (raw: string) => {
    // Validate the bin ALONE by passing only that evidence — a wrong bay must
    // stop the operator here rather than after they have also picked an item.
    const verdict = checkPickScan(context, { locationCode: raw }, task.remaining)
    if (verdict.ok === false) {
      setError(verdict.message)
      setBinCode('')
      signalFlash('reject')
      return
    }
    setError(null)
    signalFlash('ok')
    setStep('item')
  }

  const onItemScan = (raw: string) => {
    const verdict = checkPickScan(context, { locationCode: binCode, productCode: raw }, task.remaining)
    if (verdict.ok === false) {
      setError(verdict.message)
      setItemCode('')
      signalFlash('reject')
      return
    }
    setError(null)
    signalFlash('ok')
    setStep('qty')
  }

  const confirm = async () => {
    const picked = Number(qty)
    const verdict = checkPickScan(context, { locationCode: binCode, productCode: itemCode }, picked)
    if (verdict.ok === false) {
      setError(verdict.message)
      return
    }
    if (recordPick.isPending) return
    try {
      await recordPick.mutateAsync({
        orderId,
        orderItemId: task.orderItemId,
        pickedQty: picked,
        locationId: task.locationId,
        scan: { locationCode: binCode, productCode: itemCode },
      })
      // A toast is a receipt, so it carries both — unlike the scan prompt below,
      // which must quote the code alone.
      addToast(`Picked ${picked} × ${locationOneLine(bin)}`, 'success')
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record pick')
    }
  }

  if (step === 'idle') {
    return (
      <div className="flex items-center gap-3 py-1.5 pl-5">
        <MapPin className="w-3 h-3 text-stone-500 shrink-0" aria-hidden="true" />
        {/* Name first, code beneath — the same order as the walk cards. */}
        <span className="flex-1 min-w-0 truncate">
          <span className="block text-xs text-stone-600 truncate">{locationTitle(bin)}</span>
          {locationSubtitle(bin) && (
            <span className="block font-mono text-[10px] text-stone-500 truncate">{locationSubtitle(bin)}</span>
          )}
        </span>
        <span className="font-mono text-xs text-stone-500 shrink-0">
          {task.pickedQty}/{task.allocatedQty}
        </span>
        <button
          onClick={start}
          disabled={disabled || task.remaining <= 0}
          title={disabled ? 'Not your home warehouse' : undefined}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 touch-target-y bg-nexgen-blue text-white text-xs font-medium rounded-lg btn-press disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <ScanLine className="w-3 h-3" aria-hidden="true" /> Scan to pick {task.remaining}
        </button>
      </div>
    )
  }

  return (
    <div className="ml-5 my-2 p-3 rounded-lg border border-nexgen-blue/30 bg-nexgen-blue/5 space-y-3">
      {/* Progress: which of the three confirmations are done. */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <StepChip label="Bin" done={step !== 'bin'} active={step === 'bin'} value={binCode} />
        <span className="text-stone-300">→</span>
        <StepChip label="Item" done={step === 'qty'} active={step === 'item'} value={itemCode} />
        <span className="text-stone-300">→</span>
        <StepChip label="Count" done={false} active={step === 'qty'} value={step === 'qty' ? qty : ''} />
        <button
          onClick={reset}
          className="ml-auto p-1 text-stone-500 hover:text-stone-700 rounded btn-press"
          aria-label="Cancel this pick"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* The prompt quotes the CODE. generate-labels prints the code in large
          type and the name only as a small context line, so an operator
          cross-checking the sticker must be shown the string that is big on it.
          The name is stated above the field instead. */}
      {step === 'bin' && locationSubtitle(bin) && (
        <p className="text-xs text-stone-500">Go to <span className="font-medium">{locationTitle(bin)}</span></p>
      )}
      {step === 'bin' && (
        <ScanField
          label={`Scan the bin — expecting ${task.code}`}
          value={binCode}
          onChange={setBinCode}
          onScan={onBinScan}
          flash={step === 'bin' ? flash : null}
          placeholder={task.code}
          cameraTitle="Scan the bin label"
          autoFocus
          error={error ?? undefined}
        />
      )}

      {step === 'item' && (
        <ScanField
          label={`Scan the item — expecting ${line.productSku}`}
          value={itemCode}
          onChange={setItemCode}
          onScan={onItemScan}
          flash={step === 'item' ? flash : null}
          placeholder={line.productSku}
          cameraTitle="Scan the product"
          autoFocus
          helper={line.productName}
          error={error ?? undefined}
        />
      )}

      {step === 'qty' && (
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">
            How many did you pick?
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={qty}
              onChange={(e) => { setQty(e.target.value); setError(null) }}
              autoFocus
              // 44px tall: this is keyed with a thumb at a rack face.
              className="w-28 px-3 py-2 min-h-[44px] rounded-lg border border-stone-300 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
              aria-label="Quantity picked"
            />
            <span className="text-xs text-stone-500">of {task.remaining} on this task</span>
            <button
              onClick={confirm}
              disabled={recordPick.isPending}
              className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] bg-emerald-600 text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
            >
              <PackageCheck className="w-4 h-4" aria-hidden="true" />
              {recordPick.isPending ? 'Recording…' : 'Confirm pick'}
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-600 mt-1.5" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const StepChip: React.FC<{
  label: string
  done: boolean
  active: boolean
  value: string
}> = ({ label, done, active, value }) => {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${
        done
          ? 'bg-emerald-100 text-emerald-700'
          : active
            ? 'bg-nexgen-blue text-white'
            : 'bg-stone-100 text-stone-600'
      }`}
    >
      {done && <Check className="w-3 h-3" aria-hidden="true" />}
      {label}
      {done && value && <span className="font-mono opacity-70 max-w-[90px] truncate">{value}</span>}
    </span>
  )
}
