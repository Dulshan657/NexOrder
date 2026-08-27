// One stop on the putaway walk, confirmed by scanning.
//
// Two explicit steps — identify what you are carrying, then scan the bin —
// because they catch two different errors: carrying the wrong thing, and
// setting the right thing down in the wrong bay. Neither alone is evidence of
// the other.
//
// WHAT the first step asks for is not fixed. It used to be "scan the plate",
// always, whenever the task named a handling unit — and that was unanswerable
// for the commonest case on the floor: receive-stock mints a plate for every
// line, but a sticker only exists if somebody rendered one, so the walk
// routinely demanded a code printed on nothing. Meanwhile the box in the
// operator's hands had its own barcode. `putawayIdentity` (pure, shared with
// the server) decides between them from the facts; see it for the rule.
//
// Validation runs through the SAME pure module the Edge Function uses
// (_shared/putawayScanCheck), so the browser can never accept something the
// server will reject. The server re-checks regardless — this is for instant
// feedback in an aisle, not for security.
//
// The deliberate asymmetry with picking: scanning a DIFFERENT bin is not an
// error. The walker can see that the assigned bay is full or blocked, and the
// next one along is the right answer. The card warns, names both bins, and
// records where it actually went.

import React, { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, Layers, MapPin, PackageCheck, Printer, Undo2, X } from 'lucide-react'
import { ScanField } from '@/components/ui/ScanField'
import { useScanFlash } from '@/lib/scan/useScanFlash'
import { checkPutawayScan } from '@/supabase/functions/_shared/putawayScanCheck'
import { useCompletePutaway, useUnassignPutaway } from '@/hooks/queries/usePutawayWalk'
import { usePrintPlateLabels } from '@/hooks/queries/usePalletBreakdown'
import { useToasts } from '@/hooks/useToasts'
import { CompletePutawayError } from '@/services/supabase/putawayService'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import { locationSubtitle, locationTitle, type DisplayLocation } from '@/lib/locationDisplay'
import {
  classifyPutawayScan,
  identifyChipLabel,
  identifyHelper,
  identifyPlaceholder,
  identifyPrompt,
  putawayIdentity,
  type PutawayIdentity,
} from '@/lib/putawayIdentity'
import { describeQuantity, trimNumber } from './putawayFormat'
import { PalletBreakdownSheet } from './PalletBreakdownSheet'

interface PutawayStopCardProps {
  row: PendingPutawayRow
  /** The bin this task was assigned to — name AND code (mig 00094). The name is
   *  what the operator reads; the code is what they scan and what the server
   *  validates against, so both have to be here. */
  bin: DisplayLocation
  sequence: number | null
  legDistanceM: number | null
  reachable: boolean
  active: boolean
  disabled: boolean
  /** Needed by the break-down sheet, which scopes its bin picker and its engine
   *  suggestions to this site. */
  warehouseId: number
  /** Other queued tasks for this SAME product whose plates are also unlabelled.
   *  A product barcode identifies the SKU and nothing finer, so when two such
   *  plates are in the walk at once the evidence genuinely cannot say which one
   *  is in the operator's hands. The card says so rather than implying a
   *  certainty it does not have. Computed by the walk, which holds every stop. */
  unlabelledTwins: ReadonlyArray<{ huCode: string; quantity: number }>
  onActivate: () => void
  onDone: () => void
}

type Step = 'idle' | 'identify' | 'bin' | 'qty'

// React.FC deliberately: this repo ships no @types/react, so a plainly-typed
// component's props do not include `key`, and the walk renders these in a list.
export const PutawayStopCard: React.FC<PutawayStopCardProps> = ({
  row, bin, sequence, legDistanceM, reachable, active, disabled, warehouseId,
  unlabelledTwins, onActivate, onDone,
}) => {
  // The scan identity. Every scan check, placeholder and refusal message below
  // quotes this rather than the friendly name — the operator is matching a
  // string against the big text on a sticker, and that text is the code.
  const binCode = bin.code
  const { addToast } = useToasts()
  const complete = useCompletePutaway()
  const unassign = useUnassignPutaway()
  const print = usePrintPlateLabels()

  const [step, setStep] = useState<Step>('idle')
  const { flash, signal: signalFlash } = useScanFlash()
  // Captured ONCE, when the stop is opened — deliberately not derived per
  // render. `generate-labels` flips handling_units.label_printed the instant the
  // PDF exists (see confirm-label-print's header for why that is right for a
  // plate and wrong for a rack), so a live reading would swap this card into
  // "scan the plate" the moment the operator taps Print — while the sticker is
  // still in a printer on the other side of the building.
  const [identity, setIdentity] = useState<PutawayIdentity | null>(null)
  /** What is in the identify field right now. Distinct from the two accepted
   *  codes below: a refused scan clears the text and leaves the evidence empty. */
  const [identifyText, setIdentifyText] = useState('')
  const [plateCode, setPlateCode] = useState('')
  const [productCode, setProductCode] = useState('')
  const [labelUrl, setLabelUrl] = useState<string | null>(null)
  const [scannedBin, setScannedBin] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Set when the server refuses a level-role mismatch; the operator can force it.
  const [roleGate, setRoleGate] = useState<string | null>(null)
  const [breakingDown, setBreakingDown] = useState(false)

  const name = row.product?.name ?? `Product #${row.productId}`
  const qtyLabel = describeQuantity(row.quantity, row.product)

  const context = useMemo(
    () => ({
      assignedLocationCode: binCode,
      product: {
        id: row.productId,
        sku: row.product?.sku ?? '',
        name,
        barcode: row.product?.barcode ?? null,
      },
      huCode: row.huCode,
      remainingQty: row.quantity,
    }),
    [binCode, row.productId, row.product?.sku, row.product?.barcode, row.huCode, row.quantity, name],
  )

  /** Everything the operator has proved so far, in the shape checkPutawayScan
   *  and complete-putaway both take. At most one of the two identity codes is
   *  ever set — they are alternative answers to the same question. */
  const evidence = useMemo(
    () => ({
      handlingUnitCode: plateCode || undefined,
      productCode: productCode || undefined,
    }),
    [plateCode, productCode],
  )

  const reset = () => {
    setStep('idle')
    setIdentity(null)
    setIdentifyText('')
    setPlateCode('')
    setProductCode('')
    setLabelUrl(null)
    setScannedBin('')
    setQty('')
    setError(null)
    setRoleGate(null)
  }

  const start = () => {
    setError(null)
    setRoleGate(null)
    setQty(trimNumber(row.quantity))
    const decided = putawayIdentity({
      huCode: row.huCode,
      huType: row.huType,
      huLabelPrinted: row.huLabelPrinted,
      productBarcode: row.product?.barcode ?? null,
    })
    setIdentity(decided)
    // `none` means there is genuinely nothing to hold up to the gun — a legacy
    // or CSV opening-stock line with no plate, or an unlabelled plate carrying a
    // product with no barcode. Go straight to the bin rather than showing a
    // field that can only ever be skipped.
    setStep(decided.expect === 'none' ? 'bin' : 'identify')
    onActivate()
  }

  const onIdentifyScan = (raw: string) => {
    // The two answers arrive through one field as the same bare string — that is
    // the whole point of the unprefixed scan payload. The task knows its own
    // plate code, so telling them apart needs no lookup.
    const kind = classifyPutawayScan(raw, { huCode: row.huCode })
    const verdict = checkPutawayScan(
      context,
      kind === 'plate' ? { handlingUnitCode: raw } : { productCode: raw },
      row.quantity,
    )
    if (verdict.ok === false) {
      setError(verdict.message)
      setIdentifyText('')
      signalFlash('reject')
      return
    }
    // Record it under the key it actually is, and clear the other: sending both
    // would claim evidence the operator never produced.
    setPlateCode(kind === 'plate' ? raw : '')
    setProductCode(kind === 'plate' ? '' : raw)
    setError(null)
    signalFlash('ok')
    setStep('bin')
  }

  const renderLabel = async () => {
    if (row.huId == null) return
    try {
      const result = await print.mutateAsync([row.huId])
      // The URL is rendered as a link the operator TAPS. Calling window.open
      // here — after an await — is popup-blocked, every time.
      setLabelUrl(result.signedUrl)
      if (!result.signedUrl) addToast('The sheet rendered but returned no link — try again', 'error')
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not render the label', 'error')
    }
  }

  const onBinScan = (raw: string) => {
    const verdict = checkPutawayScan(context, { ...evidence, locationCode: raw }, row.quantity)
    if (verdict.ok === false) {
      setError(verdict.message)
      setScannedBin('')
      signalFlash('reject')
      return
    }
    setError(null)
    // A DIFFERENT bin is accepted here on purpose — the operator is standing at
    // the rack and the assigned bay may be full. It is recorded as
    // `placedElsewhere`, so this is an accept, not a refusal.
    signalFlash('ok')
    setStep('qty')
  }

  const placedElsewhere = useMemo(() => {
    if (!scannedBin) return false
    const verdict = checkPutawayScan(context, { ...evidence, locationCode: scannedBin }, row.quantity)
    return verdict.ok === true && verdict.placedElsewhere
  }, [context, evidence, scannedBin, row.quantity])

  const confirm = async (roleOverride = false) => {
    const placed = Number(qty)
    const verdict = checkPutawayScan(context, { ...evidence, locationCode: scannedBin }, placed)
    if (verdict.ok === false) {
      setError(verdict.message)
      return
    }
    if (complete.isPending) return
    try {
      const result = await complete.mutateAsync({
        recommendationId: row.id,
        quantity: placed < row.quantity ? placed : undefined,
        roleOverride: roleOverride || undefined,
        // No actualLocationId: the scanned code is authoritative and the server
        // resolves it, so a stale client-side location list can't misdirect stock.
        // productCode is carried as well as the plate — the server has always
        // accepted it and treats either as proof of "the thing" (see
        // checkPutawayScan's `verified`). Omitting it is what made every
        // product-identified placement land in the audit trail as
        // scan_verified: false, understating the evidence actually collected.
        scan: {
          locationCode: scannedBin,
          ...evidence,
        },
      })
      addToast(
        result.remainderQty > 0
          ? `Placed in ${result.actualLocationCode} — ${trimNumber(result.remainderQty)} still to carry`
          : result.placedElsewhere
            ? `Placed in ${result.actualLocationCode} instead of ${binCode} — recorded`
            : `Placed in ${result.actualLocationCode}`,
        result.placedElsewhere ? 'info' : 'success',
      )
      reset()
      onDone()
    } catch (e) {
      if (e instanceof CompletePutawayError && e.reason === 'level_role_mismatch') {
        setRoleGate(e.message)
        setError(null)
        return
      }
      setError(e instanceof Error ? e.message : 'Could not record the putaway')
    }
  }

  const putBack = async () => {
    try {
      await unassign.mutateAsync(row.id)
      addToast('Back on the putaway queue', 'success')
      reset()
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not unassign', 'error')
    }
  }

  // ── Collapsed ──────────────────────────────────────────────────────────────
  if (!active || step === 'idle') {
    return (
      <button
        onClick={start}
        disabled={disabled}
        className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-stone-50/70 btn-press disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="w-7 h-7 shrink-0 rounded-full bg-stone-100 text-stone-500 text-xs font-mono flex items-center justify-center">
          {sequence ?? '·'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-stone-800 truncate">{name}</span>
          <span className="block text-xs text-stone-400">
            <span className="tabular-nums text-stone-600">{qtyLabel.primary}</span>
            {row.huCode && <span className="font-mono"> · {row.huCode}</span>}
          </span>
        </span>
        <span className="shrink-0 text-right max-w-[45%] sm:max-w-none">
          <span className="block text-sm font-medium text-emerald-600 truncate">{locationTitle(bin)}</span>
          {locationSubtitle(bin) && (
            <span className="block font-mono text-[10px] text-emerald-600/60">{locationSubtitle(bin)}</span>
          )}
          <span className="block text-[11px] text-stone-400 tabular-nums">
            {reachable
              ? legDistanceM != null ? `${Math.round(legDistanceM)}m` : ''
              : 'off the map'}
          </span>
        </span>
        <ArrowRight className="w-4 h-4 text-stone-300 shrink-0" aria-hidden="true" />
      </button>
    )
  }

  // ── Active ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 bg-nexgen-blue/5 border-y border-nexgen-blue/20 space-y-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-stone-900 truncate">{name}</p>
          <p className="text-xs text-stone-500">
            <span className="tabular-nums">{qtyLabel.primary}</span>
            {qtyLabel.secondary && <span className="text-stone-400"> · {qtyLabel.secondary}</span>}
          </p>
        </div>
        <button
          onClick={reset}
          className="p-1.5 text-stone-400 hover:text-stone-700 rounded btn-press shrink-0"
          aria-label="Cancel this stop"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Destination, stated big — this is the whole point of the card. */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-white border border-stone-200">
        <MapPin className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-stone-400">Take it to</p>
          {/* Name big, because this is the instruction someone acts on while
              walking. The code stays underneath: it is what is printed large on
              the sticker they will match against. */}
          <p className="text-lg font-bold text-stone-900 truncate">{locationTitle(bin)}</p>
          {locationSubtitle(bin) && (
            <p className="font-mono text-xs text-stone-500 truncate">{locationSubtitle(bin)}</p>
          )}
        </div>
      </div>

      {/* A bin that publishing has retired still resolves to a name and a code —
          `getWarehouseLocations` returns inactive rows on purpose — so without
          this the card sends someone to a bay that is no longer on the map and
          says nothing. `complete-putaway` refuses an inactive bin outright, so
          the walk would otherwise fail only after the walk. */}
      {bin.isActive === false && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span>
            This bin has been retired from the layout. Send the line back to the
            Assign queue and re-run it so the engine picks a live bay.
          </span>
        </p>
      )}

      {/* A task can outlive its plate. A count, an adjustment or a transfer at
          the warehouse ROOT consumes balance rows without naming a plate
          (count-bin passes p_handling_unit_id => NULL deliberately);
          hu_recompute then marks the plate 'empty' and nothing touches this
          task. Without this the walk sends someone to a rack with a code that
          identifies nothing, and the placement dies inside inv_transfer_stock
          as INSUFFICIENT_STOCK — which complete-putaway rewrites into "reserved
          for an order", a sentence that is simply untrue here. */}
      {(row.huStatus === 'empty' || row.huStatus === 'cancelled') && (
        <p className="flex items-start gap-1.5 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span>
            Plate <span className="font-mono">{row.huCode}</span> is recorded as {row.huStatus} — its
            stock has already been consumed somewhere else, so this placement will be refused. Send
            the line back to the Assign queue and re-run it.
          </span>
        </p>
      )}

      {/* Product evidence names the SKU and nothing finer. With two unlabelled
          plates of the same product in the walk at once, it genuinely cannot say
          which one is being carried — so say that, rather than let a green tick
          imply a certainty nobody has. */}
      {step === 'identify' && identity?.expect === 'product' && unlabelledTwins.length > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span>
            {unlabelledTwins.map((t) => `${t.huCode} (${trimNumber(t.quantity)})`).join(', ')}{' '}
            {unlabelledTwins.length === 1 ? 'is' : 'are'} also queued for this product with no label.
            The barcode can't prove which one you're carrying — print a plate label if that matters
            here.
          </span>
        </p>
      )}

      <div className="flex items-center gap-2 text-[11px]">
        {identity && identity.expect !== 'none' && (
          <>
            <StepChip
              label={identifyChipLabel(identity)}
              done={step !== 'identify'}
              active={step === 'identify'}
              value={plateCode || productCode}
            />
            <span className="text-stone-300">→</span>
          </>
        )}
        <StepChip label="Bin" done={step === 'qty'} active={step === 'bin'} value={scannedBin} />
        <span className="text-stone-300">→</span>
        <StepChip label="Count" done={false} active={step === 'qty'} value={step === 'qty' ? qty : ''} />
      </div>

      {step === 'identify' && identity && (
        <ScanField
          label={identifyPrompt(identity, {
            huCode: row.huCode,
            productBarcode: row.product?.barcode ?? null,
            productName: name,
          })}
          value={identifyText}
          onChange={setIdentifyText}
          onScan={onIdentifyScan}
          flash={flash}
          placeholder={identifyPlaceholder(identity, {
            huCode: row.huCode,
            productBarcode: row.product?.barcode ?? null,
          })}
          cameraTitle={identity.expect === 'product' ? 'Scan the product' : 'Scan the plate label'}
          autoFocus
          helper={identifyHelper(identity)}
          error={error ?? undefined}
        />
      )}

      {/* Printing is offered LOUDLY when the plate is one that ought to carry a
          sticker (a pallet, or goods with nothing else to identify them) and
          QUIETLY otherwise — a barcode that arrived damaged is a real reason to
          want a plate label on a carton that ordinarily would not need one.
          Either way the sheet is a link the operator taps: window.open after an
          await is popup-blocked, every time. */}
      {(step === 'identify' || step === 'bin') && identity?.canPrintLabel && (
        <div
          className={`rounded-lg border p-3 space-y-2 ${
            identity.needsLabel ? 'border-amber-200 bg-amber-50' : 'border-stone-200 bg-white'
          }`}
        >
          <p className={`text-xs ${identity.needsLabel ? 'text-amber-800' : 'text-stone-500'}`}>
            {identity.needsLabel
              ? `No label has ever been printed for ${row.huCode}.`
              : 'Barcode damaged or missing?'}
          </p>
          {labelUrl ? (
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
              onClick={renderLabel}
              disabled={print.isPending}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] border border-stone-300 bg-white text-stone-700 text-sm font-medium rounded-lg btn-press disabled:opacity-50"
            >
              <Printer className="w-4 h-4" aria-hidden="true" />
              {print.isPending ? 'Rendering…' : 'Print a plate label'}
            </button>
          )}
        </div>
      )}

      {/* The prompt quotes the CODE, deliberately. generate-labels prints the
          code in large type with the name only as a small context line, so an
          operator cross-checking the sticker must be shown the same string that
          is big on it. The friendly name is stated above, in the destination
          block, where it belongs. */}
      {step === 'bin' && (
        <ScanField
          label={`Scan the bin — expecting ${binCode}`}
          value={scannedBin}
          onChange={setScannedBin}
          onScan={onBinScan}
          flash={step === 'bin' ? flash : null}
          placeholder={binCode}
          cameraTitle="Scan the bin label"
          autoFocus
          helper="A different bay is fine — it gets recorded."
          error={error ?? undefined}
        />
      )}

      {step === 'qty' && (
        <div className="space-y-3">
          {placedElsewhere && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs">
                You scanned <span className="font-mono font-medium">{scannedBin}</span>, not{' '}
                <span className="font-mono font-medium">{binCode}</span>. That's allowed — the stock will be
                recorded where you actually put it.
              </p>
            </div>
          )}

          {roleGate && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs space-y-2">
                <p>{roleGate}</p>
                <button
                  onClick={() => confirm(true)}
                  disabled={complete.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] bg-amber-600 text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
                >
                  Place anyway
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1.5">
              How much did you put away?
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={qty}
                onChange={(e) => { setQty(e.target.value); setError(null) }}
                autoFocus
                // 44px tall: keyed with a thumb, at a rack face, possibly gloved.
                className="w-28 px-3 py-2 min-h-[44px] rounded-lg border border-stone-300 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
                aria-label="Quantity put away"
              />
              <span className="text-xs text-stone-500">of {trimNumber(row.quantity)} on this task</span>
              <button
                onClick={() => confirm(false)}
                disabled={complete.isPending}
                className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] bg-emerald-600 text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
              >
                <PackageCheck className="w-4 h-4" aria-hidden="true" />
                {complete.isPending ? 'Recording…' : 'Confirm'}
              </button>
            </div>
            {Number(qty) > 0 && Number(qty) < row.quantity && (
              <p className="text-xs text-amber-600 mt-1.5">
                {trimNumber(row.quantity - Number(qty))} stays on this task for another trip.
              </p>
            )}
            {error && (
              <p className="text-xs text-red-600 mt-1.5" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={putBack}
          disabled={unassign.isPending}
          className="inline-flex items-center gap-1.5 min-h-[44px] py-2 text-xs text-stone-500 hover:text-stone-800 btn-press disabled:opacity-50"
        >
          <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
          Can't place this — put it back on the queue
        </button>

        {/* Only a pallet has anything to break down, and only a tracked one:
            a carton is one product in one box, and loose stock is already
            unattached (complete-putaway's partial quantity covers that). */}
        {row.huId != null && row.huType === 'pallet' && (
          <button
            onClick={() => setBreakingDown(true)}
            className="inline-flex items-center gap-1.5 min-h-[44px] py-2 text-xs text-nexgen-blue hover:text-nexgen-blue/80 btn-press"
          >
            <Layers className="w-3.5 h-3.5" aria-hidden="true" />
            Break this pallet down
          </button>
        )}
      </div>

      {breakingDown && (
        <PalletBreakdownSheet
          open
          warehouseId={warehouseId}
          row={row}
          onClose={() => setBreakingDown(false)}
          onDone={() => { reset(); onDone() }}
        />
      )}
    </div>
  )
}

const StepChip: React.FC<{ label: string; done: boolean; active: boolean; value: string }> = ({
  label, done, active, value,
}) => (
  <span
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${
      done ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-nexgen-blue text-white' : 'bg-stone-100 text-stone-400'
    }`}
  >
    {done && <Check className="w-3 h-3" aria-hidden="true" />}
    {label}
    {done && value && <span className="font-mono opacity-70 max-w-[90px] truncate">{value}</span>}
  </span>
)
