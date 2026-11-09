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
//
// The exception is a task sent to the product's HOME bin (NX-0032). While a home
// has room putaway must land there, and the server refuses anything else, so the
// card says so at the bin scan and stays there for a rescan, instead of letting
// the walker enter a count only to be refused at Confirm. Overflow and engine
// tasks keep the rule above.
//
// NX-0033: an OVERFLOW line (the home was full) waits for a yes, and scanning the
// bin it names confirms it. A Manager or Admin can give a product with NO home one:
// the stop retargets to the chosen bin and the home is set when the stock lands
// (make_home). Presentation lives in Stop*.tsx / GiveHome*.tsx, rules in walkStops.ts.

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Layers, PackageCheck, Printer, Undo2, X } from 'lucide-react'
import { ScanField } from '@/components/ui/ScanField'
import { Callout } from '@/components/ui'
import { useScanFlash } from '@/lib/scan/useScanFlash'
import { checkPutawayScan } from '@/supabase/functions/_shared/putawayScanCheck'
import { useCompletePutaway, useConfirmOverflow, useUnassignPutaway } from '@/hooks/queries/usePutawayWalk'
import { usePrintPlateLabels } from '@/hooks/queries/usePalletBreakdown'
import { useToastActions } from '@/hooks/useToasts'
import { CompletePutawayError } from '@/services/supabase/putawayService'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import { locationTitle, type DisplayLocation } from '@/lib/locationDisplay'
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
import { StopCollapsedRow } from './StopCollapsedRow'
import { StopDestination } from './StopDestination'
import { StopProgressRail } from './StopProgressRail'
import { GiveHomeOffer } from './GiveHomeOffer'
import { GiveHomeSheet } from './GiveHomeSheet'
import { homeTargetCopy, isOverflowConfirmStop, overflowConfirmCopy } from './walkStops'
import type { HomeBinChoice } from '@/services/supabase/homeBinHealthService'

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
  /** A Manager or Admin: a stop for a product with no home bin may offer to
   *  give it one. The server refuses anyone else; this only hides the offer. */
  canSetHome?: boolean
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
  canSetHome = false, unlabelledTwins, onActivate, onDone,
}) => {
  const { addToast } = useToastActions()
  const complete = useCompletePutaway()
  const unassign = useUnassignPutaway()
  const confirmOverflow = useConfirmOverflow()
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
  // The walker's bin scan said yes to this overflow bin (NX-0033). The row prop
  // only catches up once the walk has refetched, so the card remembers it
  // meanwhile and does not go back to asking.
  const [overflowConfirmed, setOverflowConfirmed] = useState(false)
  // Giving a product with no home one (NX-0033, G4). `homeOffer`: the chooser is
  // open, or the manager said "Not now". `homeTarget`: the bin they chose, which
  // the stop is retargeted to; the home is only SET when the stock lands there,
  // in the same transaction (make_home), so neither outlives the stop.
  const [homeOffer, setHomeOffer] = useState<'open' | 'declined' | null>(null)
  const [homeTarget, setHomeTarget] = useState<HomeBinChoice | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const qtyFieldId = useId()
  // The bin this stop is at: the one it was sent to, or the one a manager chose
  // as the product's home. The scan identity. Every scan check, placeholder and
  // refusal message below quotes this rather than the friendly name — the
  // operator is matching a string against the big text on a sticker, and that
  // text is the code.
  const shownBin: DisplayLocation = homeTarget
    ? { code: homeTarget.binCode, name: homeTarget.binName, isActive: true }
    : bin
  const binCode = shownBin.code

  const name = row.product?.name ?? `Product #${row.productId}`
  const qtyLabel = describeQuantity(row.quantity, row.product)
  const isHomeTask =
    row.suggestionSource === 'home' &&
    row.recommendedLocationId != null &&
    row.assignedLocationId === row.recommendedLocationId
  // A loose line whose home was full: scanning its suggested bin is the yes.
  const awaitingConfirm = isOverflowConfirmStop(row) && !overflowConfirmed
  const confirmCopy = overflowConfirmCopy(binCode)
  const sku = row.product?.sku ?? name
  const homeCopy = homeTarget ? homeTargetCopy(homeTarget.binCode, sku) : null
  // Only a Manager or Admin may give a product a home, and only while it has none
  // NOW: `homeLocationId` is read with the walk, so a home set meanwhile (from
  // this walk, a sibling line or remainder of the SKU, the desk's editor) stops
  // the offer once the walk refreshes. The planner's `engine` tag would not: it
  // says what was true when the line was made. Unknown (undefined) is not none.
  // A pallet is not held to a home, and an overflow line's product has one.
  const offersHome = canSetHome && row.homeLocationId === null
    && !row.unitLoad && !isOverflowConfirmStop(row)
    && homeTarget === null && homeOffer !== 'declined'

  // The code is the hero on this card and the name is the supporting line — the
  // reverse of how `locationDisplay` orders them, and deliberately so. That module
  // is written for a bin being READ in a list; this is a bin being MATCHED against
  // a sticker at arm's length, and the sticker has the code on it in large type.
  // `locationTitle` falls back to the code when the name says nothing, so guard
  // against printing the same string twice — that is exactly what
  // `locationSubtitle` returning '' exists to prevent.
  const binName = locationTitle(shownBin)
  const hasBinName = binName !== binCode

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
    setHomeOffer(null)
    setHomeTarget(null)
  }

  // Choosing a home swaps the sheet for the stop's scan field. A scan only
  // reaches the FOCUSED field, so put the focus back where the gun is aimed:
  // after the sheet's own cleanup, which hands it to a button that is gone.
  useEffect(() => {
    if (homeTarget) rootRef.current?.querySelector<HTMLInputElement>('[data-scan-field]')?.focus()
  }, [homeTarget])

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

  const onBinScan = async (raw: string) => {
    const verdict = checkPutawayScan(context, { ...evidence, locationCode: raw }, row.quantity)
    if (verdict.ok === false) {
      setError(verdict.message)
      setScannedBin('')
      signalFlash('reject')
      return
    }
    // A task the planner sent to the product's HOME goes there or is refused
    // (NX-0032): do not advance to the count with the wrong bay. Only while the
    // task still points at that suggested bin: a desk that assigned it elsewhere
    // made its own call, and the server judges that against the room at the home.
    if (isHomeTask && verdict.placedElsewhere) {
      setError(`This product's home bin is ${binCode}. Scan ${binCode}.`)
      setScannedBin('')
      signalFlash('reject')
      return
    }
    // A chosen home is the bin this stock is going to (NX-0033): it becomes the
    // home when it lands, so the engine's bay is no longer an option.
    if (homeCopy && verdict.placedElsewhere) {
      setError(homeCopy.wrongBin)
      setScannedBin('')
      signalFlash('reject')
      return
    }
    // An overflow line waits for a yes (NX-0033), and only the bin it names can
    // give it: another bay is left for the desk, not decided here. The server
    // compares the scanned bin with the line's own under its row lock, so a desk
    // redirect that landed after this walk loaded is refused, in its words.
    if (awaitingConfirm) {
      if (verdict.placedElsewhere || row.recommendedLocationId == null) {
        setError(confirmCopy.wrongBin)
        setScannedBin('')
        signalFlash('reject')
        return
      }
      if (confirmOverflow.isPending) return
      try {
        await confirmOverflow.mutateAsync({
          recommendationId: row.id,
          locationId: row.recommendedLocationId,
        })
      } catch (e) {
        // Shown as the server wrote it, where the walker is looking and as a toast
        // too, because the refresh the hook triggers can take this stop away (a
        // desk redirect puts the line back on the Assign tab). The card stays on
        // the bin step: whatever the refreshed stop turns out to be, it is
        // scanned from here.
        const message = e instanceof Error ? e.message : 'Could not confirm the bin, try again.'
        setError(message)
        setScannedBin('')
        signalFlash('reject')
        addToast(message, 'error')
        return
      }
      setOverflowConfirmed(true)
      addToast(confirmCopy.confirmed, 'success')
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
        // Only with a home chosen: the server sets it in the same transaction as
        // the move, and refuses a bin that can't be one (or a product that has
        // meanwhile got one) in words the catch below shows as they are.
        ...(homeTarget ? { makeHome: true } : {}),
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
      if (homeCopy) {
        // Said either way: a home set by someone else meanwhile is news to the
        // manager who meant to set it.
        const placedIn = result.actualLocationCode ?? binCode
        addToast(
          result.homeSet ? homeCopy.placedAndSet(placedIn) : homeCopy.placedNotSet(placedIn),
          result.homeSet ? 'success' : 'info',
        )
      } else {
        addToast(
          result.remainderQty > 0
            ? `Placed in ${result.actualLocationCode} — ${trimNumber(result.remainderQty)} still to carry`
            : result.placedElsewhere
              ? `Placed in ${result.actualLocationCode} instead of ${binCode} — recorded`
              : `Placed in ${result.actualLocationCode}`,
          result.placedElsewhere ? 'info' : 'success',
        )
      }
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
      // Back to `suggested`: an overflow line asks for its yes again.
      setOverflowConfirmed(false)
      reset()
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not unassign', 'error')
    }
  }

  // ── Collapsed ──────────────────────────────────────────────────────────────
  if (!active || step === 'idle') {
    return (
      <StopCollapsedRow
        sequence={sequence}
        binCode={binCode}
        name={name}
        qtyPrimary={qtyLabel.primary}
        huCode={row.huCode}
        legDistanceM={legDistanceM}
        reachable={reachable}
        disabled={disabled}
        awaitingConfirm={awaitingConfirm}
        onOpen={start}
      />
    )
  }

  // ── Active ─────────────────────────────────────────────────────────────────

  // The rail below renders whichever steps this task actually has: `identify` is
  // dropped entirely when there is nothing to hold up to the gun (`expect:'none'`),
  // which is the same condition `start()` uses to skip straight to the bin.
  const stages: ReadonlyArray<{ key: Step; label: string; value: string }> = [
    ...(identity && identity.expect !== 'none'
      ? [{ key: 'identify' as Step, label: identifyChipLabel(identity), value: plateCode || productCode }]
      : []),
    { key: 'bin', label: 'Bin', value: scannedBin },
    { key: 'qty', label: 'Count', value: step === 'qty' ? qty : '' },
  ]
  const STAGE_ORDER: ReadonlyArray<Step> = ['identify', 'bin', 'qty']

  return (
    <div
      ref={rootRef}
      className={`bg-nexgen-blue/5 border-y border-nexgen-blue/20 ${flash === 'ok' ? 'scan-accept' : ''}`}
    >
      <StopProgressRail stages={stages} order={STAGE_ORDER} step={step} />

      <StopDestination
        heading={awaitingConfirm ? confirmCopy.heading : undefined}
        binCode={binCode}
        binName={hasBinName ? binName : undefined}
        qty={qtyLabel}
        huCode={row.huCode}
      />

      <div className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-sm font-medium text-stone-900">{name}</p>
          <button
            onClick={reset}
            className="touch-target -m-2 flex items-center justify-center rounded-lg p-2 text-stone-600 hover:text-stone-900 hover:bg-white/70 btn-press shrink-0"
            aria-label="Cancel this stop"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

      {/* A bin that publishing has retired still resolves to a name and a code —
          `getWarehouseLocations` returns inactive rows on purpose — so without
          this the card sends someone to a bay that is no longer on the map and
          says nothing. `complete-putaway` refuses an inactive bin outright, so
          the walk would otherwise fail only after the walk. */}
      {shownBin.isActive === false && (
        <Callout tone="warning" dense icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}>
          This bin has been retired from the layout. Send the line back to the
          Assign queue and re-run it so the engine picks a live bay.
        </Callout>
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
        <Callout tone="danger" dense icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}>
          Plate <span className="font-mono">{row.huCode}</span> is recorded as {row.huStatus} — its
          stock has already been consumed somewhere else, so this placement will be refused. Send
          the line back to the Assign queue and re-run it.
        </Callout>
      )}

      {/* Product evidence names the SKU and nothing finer. With two unlabelled
          plates of the same product in the walk at once, it genuinely cannot say
          which one is being carried — so say that, rather than let a green tick
          imply a certainty nobody has. */}
      {step === 'identify' && identity?.expect === 'product' && unlabelledTwins.length > 0 && (
        <Callout tone="warning" dense icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}>
          {unlabelledTwins.map((t) => `${t.huCode} (${trimNumber(t.quantity)})`).join(', ')}{' '}
          {unlabelledTwins.length === 1 ? 'is' : 'are'} also queued for this product with no label.
          The barcode can't prove which one you're carrying — print a plate label if that matters
          here.
        </Callout>
      )}

      {step === 'identify' && identity && (
        <div className="step-advance">
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
        </div>
      )}

      {/* Printing is offered LOUDLY when the plate is one that ought to carry a
          sticker (a pallet, or goods with nothing else to identify them) and
          QUIETLY otherwise — a barcode that arrived damaged is a real reason to
          want a plate label on a carton that ordinarily would not need one.
          Either way the sheet is a link the operator taps: window.open after an
          await is popup-blocked, every time. */}
      {/* The QUIET half is now one line rather than a bordered panel. At 360px
          that panel cost ~90px of the ~548px the card has to fit a scan field and
          a Confirm button into, to say "barcode damaged?" — a question that is
          almost always no. The LOUD half keeps its full treatment, because when
          `needsLabel` is true the operator is being told the sticker they are
          looking for does not exist. */}
      {(step === 'identify' || step === 'bin') && identity?.canPrintLabel && (
        identity.needsLabel || labelUrl ? (
          <Callout
            tone={identity.needsLabel ? 'warning' : 'neutral'}
            dense
            icon={<Printer className="w-4 h-4" aria-hidden="true" />}
            action={
              labelUrl ? (
                <a
                  href={labelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="touch-target-y inline-flex items-center gap-1.5 px-3.5 py-2 bg-nexgen-blue text-white text-sm font-medium rounded-lg btn-press"
                >
                  <Printer className="w-4 h-4" aria-hidden="true" />
                  Open the label sheet
                </a>
              ) : (
                <button
                  type="button"
                  onClick={renderLabel}
                  disabled={print.isPending}
                  className="touch-target-y inline-flex items-center gap-1.5 px-3.5 py-2 border border-stone-300 bg-white text-stone-700 text-sm font-medium rounded-lg btn-press disabled:opacity-50"
                >
                  <Printer className="w-4 h-4" aria-hidden="true" />
                  {print.isPending ? 'Rendering…' : 'Print a plate label'}
                </button>
              )
            }
          >
            {identity.needsLabel
              ? `No label has ever been printed for ${row.huCode}.`
              : 'The label sheet is ready.'}
          </Callout>
        ) : (
          <button
            type="button"
            onClick={renderLabel}
            disabled={print.isPending}
            className="touch-target-y inline-flex items-center gap-1.5 py-2 text-xs text-nexgen-blue-dark hover:underline btn-press disabled:opacity-50"
          >
            <Printer className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {print.isPending ? 'Rendering…' : 'Barcode damaged? Print a plate label'}
          </button>
        )
      )}

      {/* The prompt quotes the CODE, deliberately. generate-labels prints the
          code in large type with the name only as a small context line, so an
          operator cross-checking the sticker must be shown the same string that
          is big on it. The friendly name is stated above, in the destination
          block, where it belongs. */}
      {step === 'bin' && (
        <div className="step-advance">
          <ScanField
            label={homeCopy?.scanLabel ?? (awaitingConfirm ? confirmCopy.scanLabel : `Scan the bin — expecting ${binCode}`)}
            value={scannedBin}
            onChange={setScannedBin}
            onScan={onBinScan}
            flash={step === 'bin' ? flash : null}
            placeholder={binCode}
            cameraTitle="Scan the bin label"
            autoFocus
            helper={homeCopy
              ? undefined
              : awaitingConfirm
                ? confirmCopy.helper
                : isHomeTask
                  ? "This product's home bin. It goes here while the home has room."
                  : 'A different bay is fine — it gets recorded.'}
            error={error ?? undefined}
          />
        </div>
      )}

      {/* A product with no home: a manager can name one before the stock is put
          down. Shown while the thing and the bin are still being proved, not at
          the count, when the stop is already committed to a bin. */}
      {(step === 'identify' || step === 'bin') && offersHome && (
        <GiveHomeOffer onGive={() => setHomeOffer('open')} onDecline={() => setHomeOffer('declined')} />
      )}

      {step === 'qty' && (
        <div className="step-advance space-y-3">
          {placedElsewhere && (
            <Callout tone="warning" dense icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}>
              You scanned <span className="font-mono font-medium">{scannedBin}</span>, not{' '}
              <span className="font-mono font-medium">{binCode}</span>. That's allowed — the stock will be
              recorded where you actually put it.
            </Callout>
          )}

          {roleGate && (
            <Callout
              tone="warning"
              dense
              icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}
              action={
                <button
                  onClick={() => confirm(true)}
                  disabled={complete.isPending}
                  className="touch-target-y inline-flex items-center gap-1.5 px-3 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg btn-press disabled:opacity-50"
                >
                  Place anyway
                </button>
              }
            >
              {roleGate}
            </Callout>
          )}

          <div>
            {/* `aria-labelledby` as well as `htmlFor`, and NOT a duplicate
                `aria-label`: the visible text is then the accessible name, so the
                two cannot drift apart. The pair is also what
                `jsx-a11y/control-has-associated-label` can actually see —
                `htmlFor`/`id` alone is a runtime association the static rule
                cannot resolve across siblings, and the suppressions file is a
                one-way ratchet that must not be fed by hand. */}
            <label
              id={`${qtyFieldId}-label`}
              htmlFor={qtyFieldId}
              className="block text-xs font-semibold text-stone-600 mb-1.5"
            >
              How much did you put away?
            </label>
            <div className="flex items-center gap-2">
              <input
                id={qtyFieldId}
                aria-labelledby={`${qtyFieldId}-label`}
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={qty}
                onChange={(e) => { setQty(e.target.value); setError(null) }}
                autoFocus
                // `touch-target-y` rather than an arbitrary min-h: an arbitrary
                // value sorts AFTER the named utility, so layering the two would
                // silently win against the 44px floor.
                className="touch-target-y w-24 shrink-0 px-3 py-2 rounded-lg border border-stone-300 text-base font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark focus:border-nexgen-blue"
              />
              <span className="min-w-0 text-xs text-stone-600">
                of {trimNumber(row.quantity)} on this task
              </span>
            </div>
            {Number(qty) > 0 && Number(qty) < row.quantity && (
              <p className="text-xs text-amber-700 mt-1.5">
                {trimNumber(row.quantity - Number(qty))} stays on this task for another trip.
              </p>
            )}
            {error && (
              <p className="text-xs text-red-600 mt-1.5" role="alert">
                {error}
              </p>
            )}
            {/* Full width, and last. It is the only committing action on the card,
                and on a 360px screen a button that shares a row with an input is a
                button somebody misses with a gloved thumb. */}
            <button
              onClick={() => confirm(false)}
              disabled={complete.isPending}
              className="touch-target-y mt-3 flex w-full items-center justify-center gap-1.5 px-3.5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg btn-press disabled:opacity-50"
            >
              <PackageCheck className="w-4 h-4" aria-hidden="true" />
              {complete.isPending ? 'Recording…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {/* Both escape hatches on one line. They are the rarest controls on the
          card and they were costing two stacked 44px rows of the height budget.
          Neither applies while the line still waits for its yes (NX-0033): it is
          not assigned, so there is nothing to put back, and a pallet is broken
          down once the bin is settled. */}
      {!awaitingConfirm && (
      <div className="flex items-center justify-between gap-3 border-t border-nexgen-blue/15 pt-1">
        <button
          onClick={putBack}
          disabled={unassign.isPending}
          className="touch-target-y inline-flex min-w-0 items-center gap-1.5 py-2 text-xs text-stone-600 hover:text-stone-900 btn-press disabled:opacity-50"
        >
          <Undo2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Put it back on the queue</span>
        </button>

        {/* Only a pallet has anything to break down, and only a tracked one:
            a carton is one product in one box, and loose stock is already
            unattached (complete-putaway's partial quantity covers that). */}
        {row.huId != null && row.huType === 'pallet' && (
          <button
            onClick={() => setBreakingDown(true)}
            className="touch-target-y inline-flex shrink-0 items-center gap-1.5 py-2 text-xs text-nexgen-blue-dark hover:underline btn-press"
          >
            <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            Break down
          </button>
        )}
        </div>
      )}
      </div>

      {canSetHome && homeOffer === 'open' && (
        <GiveHomeSheet
          open
          warehouseId={warehouseId}
          productId={row.productId}
          sku={sku}
          recommendationId={row.id}
          onClose={() => setHomeOffer(null)}
          onChoose={(chosen) => { setHomeTarget(chosen); setHomeOffer(null); setError(null) }}
        />
      )}

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
