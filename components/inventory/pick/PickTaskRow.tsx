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
//
// Two additions for an order imported from an invoice (NX-0029), where the system's
// stock records may not match the shelf:
//  - an UNRESERVED task (`task.unreserved`) is a bin with free stock offered for the
//    part of the line no reservation covers. It is picked exactly like a directed one.
//  - ANY-BIN mode (`anyBin`) is for a line with no bin holding recorded stock. The bin
//    is not given, it is scanned: any bin, then the item, then the count. The bin's
//    location id comes from resolving the scanned code, and the row says plainly that
//    the system shows none of the item there.

import React, { useMemo, useRef, useState } from 'react'
import { MapPin, PackageCheck, ScanLine, X } from 'lucide-react'
import { ScanField } from '@/components/ui/ScanField'
import { useScanFlash } from '@/lib/scan/useScanFlash'
import { checkPickScan } from '@/supabase/functions/_shared/pickScanCheck'
import { useRecordPick } from '@/hooks/queries/usePickQueue'
import { useToastActions } from '@/hooks/useToasts'
import type { PickQueueLine, PickTask } from '@/services/supabase/pickService'
import { locationOneLine, locationSubtitle, locationTitle } from '@/lib/locationDisplay'
import { refusalMessage } from '@/lib/pickRefusal'
import { StepChip } from './StepChip'
import type { PickBinResolution, ResolvedPickBin } from './resolvePickBin'

interface PickTaskRowProps {
  orderId: string
  task: PickTask
  line: PickQueueLine
  disabled: boolean
  /** Friendly name for the bin (mig 00094). Resolved by the queue via
   *  useLocationNames — the pick path is ORDER-scoped, so it has no warehouse
   *  locations query to read from. Absent falls back to the code. */
  binName?: string | null
  /** Any-bin mode: `task` is then the line's open amount (it names no real bin), and
   *  the bin is found by scanning. `resolveBin` turns what was scanned into a bin, or
   *  says why it is not one. */
  anyBin?: { resolveBin: (raw: string) => PickBinResolution }
  /** An order imported from an invoice (NX-0029). A pick on it refetches the order's tasks,
   *  because it can take stock outside the reservation and so change what is on offer. */
  imported?: boolean
}

type Step = 'idle' | 'bin' | 'item' | 'qty'

// React.FC deliberately: this repo ships no @types/react, so a plainly-typed
// function component's props interface does not include `key`, and callers
// rendering it in a list fail to type-check. Same reason the rest of the
// codebase uses React.FC. (See the types gotcha in CLAUDE.md.)
export const PickTaskRow: React.FC<PickTaskRowProps> = ({ orderId, task, line, disabled, binName, anyBin, imported }) => {
  const bin = { code: task.code, name: binName ?? null }
  const { addToast } = useToastActions()
  const recordPick = useRecordPick()

  const [step, setStep] = useState<Step>('idle')
  const { flash, signal: signalFlash } = useScanFlash()
  const [binCode, setBinCode] = useState('')
  const [itemCode, setItemCode] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Any-bin mode only: the bin the picker's scan resolved to.
  const [found, setFound] = useState<ResolvedPickBin | null>(null)
  // A second tap can land before the button has re-rendered as disabled, and a pick
  // posted twice is counted twice: a ref is read synchronously, `isPending` is not.
  const posting = useRef(false)

  // The bin the scans are checked against: the task's own, or the one just resolved.
  const expectedCode = anyBin ? (found?.code ?? '') : task.code

  const context = useMemo(
    () => ({
      taskLocationCode: expectedCode,
      product: {
        id: line.productId,
        sku: line.productSku,
        name: line.productName,
        barcode: line.productBarcode,
      },
      remainingQty: task.remaining,
    }),
    [expectedCode, task.remaining, line.productId, line.productSku, line.productName, line.productBarcode],
  )

  const reset = () => {
    setStep('idle')
    setBinCode('')
    setItemCode('')
    setQty('')
    setError(null)
    setFound(null)
  }

  const start = () => {
    setError(null)
    setQty(String(task.remaining))
    setStep('bin')
  }

  const onBinScan = (raw: string) => {
    if (anyBin) {
      // Any bin will do, so there is nothing to compare against: find out which bin it is.
      const resolution = anyBin.resolveBin(raw)
      if (resolution.ok === false) {
        setError(resolution.message)
        setBinCode('')
        signalFlash('reject')
        return
      }
      setFound(resolution.location)
      setError(null)
      signalFlash('ok')
      setStep('item')
      return
    }
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
    if (recordPick.isPending || posting.current) return
    const locationId = anyBin ? found?.id : task.locationId
    if (locationId == null) return
    posting.current = true
    try {
      await recordPick.mutateAsync({
        orderId,
        orderItemId: task.orderItemId,
        pickedQty: picked,
        locationId,
        scan: { locationCode: binCode, productCode: itemCode },
        // On an imported order a pick can move stock outside the reservation, so what is
        // on offer changes. An ordinary order keeps its optimistic patch and nothing more.
        refreshTasks: imported === true,
      })
      // A toast is a receipt, so it carries both — unlike the scan prompt below,
      // which must quote the code alone.
      addToast(`Picked ${picked} × ${locationOneLine(anyBin ? { code: expectedCode, name: found?.name } : bin)}`, 'success')
      reset()
    } catch (err) {
      // A refusal is shown in the row and everything scanned is kept, so the picker
      // can read why and correct one thing instead of starting again.
      setError(refusalMessage(err, 'Could not record the pick.'))
    } finally {
      posting.current = false
    }
  }

  if (step === 'idle' && anyBin) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5 pl-5">
        <MapPin className="w-3 h-3 text-stone-500 shrink-0" aria-hidden="true" />
        <span className="flex-1 min-w-[10rem] text-xs text-stone-600">
          The system shows no available stock of this item in any bin.
        </span>
        <button
          onClick={start}
          disabled={disabled || task.remaining <= 0}
          // The dark brand shade: white on plain nexgen-blue is 3.70:1, one of the disclosed
          // exceptions, and new controls are not added to that list (docs/claude/accessibility.md).
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 touch-target-y bg-nexgen-blue-dark text-white text-xs font-medium rounded-lg btn-press disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <ScanLine className="w-3 h-3" aria-hidden="true" /> Scan a bin to pick
        </button>
      </div>
    )
  }

  if (step === 'idle') {
    return (
      // Wraps: on a 360px screen the label, the count and the button do not fit on one
      // line, and truncating the label left the bin name as an ellipsis. The label keeps
      // a floor of 8rem and the button drops below it instead.
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5 pl-5">
        <MapPin className="w-3 h-3 text-stone-500 shrink-0" aria-hidden="true" />
        {/* Name first, code beneath — the same order as the walk cards. */}
        <span className="flex-1 min-w-[8rem] break-words">
          <span className="block text-xs text-stone-600 break-words">{locationTitle(bin)}</span>
          {locationSubtitle(bin) && (
            <span className="block font-mono text-[10px] text-stone-500 break-all">{locationSubtitle(bin)}</span>
          )}
          {task.unreserved && (
            <span className="block text-[11px] text-stone-600 break-words">Not reserved for this order</span>
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
        <span className="text-stone-500">→</span>
        <StepChip label="Item" done={step === 'qty'} active={step === 'item'} value={itemCode} />
        <span className="text-stone-500">→</span>
        <StepChip label="Count" done={false} active={step === 'qty'} value={step === 'qty' ? qty : ''} />
        <button
          onClick={reset}
          className="ml-auto p-1 text-stone-500 hover:text-stone-700 rounded btn-press"
          aria-label="Cancel this pick"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {anyBin && step !== 'bin' && found && (
        // Said again once the bin is known, because the picker is about to take stock
        // from a shelf the records say is empty: count what is really there.
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800" role="note">
          Not in the stock record: the system shows no available stock of this item at {found.code}. Pick only what you can see on the shelf.
        </p>
      )}

      {/* The prompt quotes the CODE. generate-labels prints the code in large
          type and the name only as a small context line, so an operator
          cross-checking the sticker must be shown the string that is big on it.
          The name is stated above the field instead. */}
      {!anyBin && step === 'bin' && locationSubtitle(bin) && (
        <p className="text-xs text-stone-500">Go to <span className="font-medium">{locationTitle(bin)}</span></p>
      )}
      {step === 'bin' && (
        <ScanField
          label={anyBin ? 'Scan the bin you found it in' : `Scan the bin — expecting ${task.code}`}
          value={binCode}
          onChange={setBinCode}
          onScan={onBinScan}
          flash={step === 'bin' ? flash : null}
          placeholder={anyBin ? 'Any bin code' : task.code}
          cameraTitle="Scan the bin label"
          autoFocus
          helper={anyBin ? 'The system shows no available stock of this item in any bin.' : undefined}
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
            <span className="text-xs text-stone-500">
              {anyBin ? `of ${task.remaining} still open on this line` : `of ${task.remaining} on this task`}
            </span>
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
