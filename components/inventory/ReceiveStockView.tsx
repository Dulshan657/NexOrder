import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Product, User, PutawayLineRecommendation } from '../../types'
import { UserRole } from '../../types'
import { useReceiveStock } from '../../hooks/queries/useReceiveStock'
import { useSuppliers } from '../../hooks/queries/useSuppliers'
import { useLevelRoles } from '@/hooks/queries/useLevelRoles'
import { useSettings } from '../../hooks/queries/useSettings'
import { useReceivingRequirements } from '@/hooks/queries/useReceivingRequirements'
import { palletSpecFromSettings } from '../../lib/palletUom'
import { roleLabel, rolesForHuType } from '@/lib/levelRoles'
import { useWarehouses } from '../../hooks/queries/useWarehouses'
import type { ReceiptHeader, ReceiptLine, ReceiptPlate } from '../../services/supabase/receivingService'
import { useToastActions } from '../../hooks/useToasts'
import { baseUom } from '../../lib/uom'
import { productsForSupplier, matchesProductQuery } from '../../lib/productSuppliers'
import StickyScanBar from './StickyScanBar'
import ReceiveLineCard, { RECEIVE_ROW_COLUMNS } from './receive/ReceiveLineCard'
import MixedPalletCard from './receive/MixedPalletCard'
import DeliveryStrip, { type SupplierOption } from './receive/DeliveryStrip'
import ReceiveWorkBar, { type ReceiveTotals } from './receive/ReceiveWorkBar'
import ReceiveSuccessCard, { type ReceivedSummary } from './receive/ReceiveSuccessCard'
import RecentReceiptsPanel from './receive/RecentReceiptsPanel'
import {
  missingRequired,
  newDraft,
  newMixedPlate,
  newPlate,
  plateLabel,
  type DraftLine,
  type LineRequirement,
} from './receive/receiveDraft'
import { emptyStaging, scanUomFor, stageProduct, type StagingState } from './receive/stageProduct'
import { buildScanIndex, normalizeScan } from '../../lib/scan/resolveScan'
import { describeReceiveRefusal, resolveReceiveScan } from '../../lib/scan/receiveScan'
import { useScanFlash } from '../../lib/scan/useScanFlash'
import { useWedgeScanner } from '../../lib/scan/useWedgeScanner'
import { PackagePlus, ScanLine } from 'lucide-react'

interface ReceiveStockViewProps {
  products: Product[]
  currentUser: User
  /** Navigate to the Putaway tab pre-selected to a warehouse — wired to the
   *  post-receipt "Go to putaway" CTA. Undefined when the host doesn't support
   *  cross-tab navigation (keeps this view mountable standalone/in tests). */
  onOpenPutaway?: (warehouseId: number) => void
}

// `DraftLine`, `DraftPlate`, `newDraft`, `newPlate` and `plateLabel` live in
// ./receive/receiveDraft.ts — the line row needs them too, and importing them
// back from here would make a cycle. Re-exported because `plateLabel` was part
// of this module's public surface.
export { plateLabel }

const todayIso = (): string => new Date().toISOString().slice(0, 10)

/** How long a scanned line stays tinted, so the operator sees which one moved. */
const TOUCH_FLASH_MS = 900

/**
 * Default destination warehouse for a goods receipt: the user's home site when
 * it is active, otherwise the first active warehouse, else null (no active
 * site — the server routes to the system default). Unlike the layout viewer's
 * resolver, receiving does not care whether a site is racked or published.
 */
export function resolveReceiveDestination(
  activeWarehouses: readonly { id: number }[],
  homeWarehouseId: number | undefined,
): number | null {
  if (activeWarehouses.length === 0) return null
  if (homeWarehouseId != null && activeWarehouses.some((w) => w.id === homeWarehouseId)) {
    return homeWarehouseId
  }
  return activeWarehouses[0].id
}

/**
 * Scroll a just-counted line into the part of the scroller the pinned scan bar
 * does NOT cover. `scrollIntoView({ block: 'nearest' })` ignores sticky
 * overlays, so below `lg` it parked the line's bottom edge exactly under the
 * bottom dock, and at `lg` under the top bar. Every call is optional: jsdom
 * implements no layout and no scrolling.
 */
function revealBesideDock(el: HTMLElement): void {
  const main = el.closest('[data-scroll-container]') as HTMLElement | null
  const dock = document.querySelector('[data-scan-dock]') as HTMLElement | null
  if (!main || !dock || typeof main.scrollBy !== 'function') return
  const r = el.getBoundingClientRect()
  const d = dock.getBoundingClientRect()
  const m = main.getBoundingClientRect()
  const dockAtBottom = d.bottom >= m.bottom - 1
  const visibleTop = dockAtBottom ? m.top : d.bottom
  const visibleBottom = dockAtBottom ? d.top : m.bottom
  const GAP = 8
  if (r.bottom > visibleBottom) main.scrollBy({ top: r.bottom - visibleBottom + GAP, behavior: 'smooth' })
  else if (r.top < visibleTop) main.scrollBy({ top: r.top - visibleTop - GAP, behavior: 'smooth' })
}

/** The unit a line is counted in, by code, for the totals ("148 carton"). */
function lineUnitCode(line: DraftLine, product: Product | undefined): string {
  const own = product?.uoms?.find((u) => u.id === line.uomId)
  if (own) return own.code
  return baseUom(product?.uoms)?.code ?? product?.unit ?? 'each'
}

/** "148 carton · 3 each" — staged quantity grouped by the unit it is counted in. */
function unitsSummary(lines: readonly DraftLine[], productById: ReadonlyMap<number, Product>): string {
  const byUnit = new Map<string, number>()
  for (const l of lines) {
    const qty = Number(l.quantity) || 0
    if (qty <= 0 || l.productId == null) continue
    const code = lineUnitCode(l, productById.get(l.productId))
    byUnit.set(code, (byUnit.get(code) ?? 0) + qty)
  }
  return [...byUnit].map(([code, qty]) => `${qty} ${code}`).join(' · ')
}

const ReceiveStockView: React.FC<ReceiveStockViewProps> = ({ products, currentUser, onOpenPutaway }) => {
  const { addToast } = useToastActions()
  const receive = useReceiveStock()
  const { data: supplierRows } = useSuppliers()
  const { data: warehouseRows } = useWarehouses()
  // Operator-managed role vocabulary (mig 00081). The plate-type dropdown tells
  // the receiver where each kind of unit will be steered, so it has to read the
  // routing rather than restate it.
  const { data: levelRoles = [] } = useLevelRoles()
  // The global pallet (mig 00125) — only so a Pallet unit can say whether its
  // quantity was measured or estimated, at the moment it becomes real stock.
  const { data: settingsRow } = useSettings()
  const palletSpec = useMemo(() => palletSpecFromSettings(settingsRow), [settingsRow])
  // Which products must arrive with a lot code / expiry (mig 00134).
  const { data: requirements, isError: requirementsFailed } = useReceivingRequirements()
  const requirementFor = (productId: number | null): LineRequirement | undefined =>
    productId == null ? undefined : requirements?.get(productId)

  // Phrased as a PREDICTION, not a destination: putaway may place this
  // anywhere, the SKU's own rule outranks the plate preference, and the
  // operator can break a pallet down on the floor.
  const plateDestinationLabel = (huType: 'pallet' | 'carton'): string => {
    const noun = huType === 'pallet' ? 'Pallet' : 'Carton'
    const dest = rolesForHuType(levelRoles, huType).map((k) => roleLabel(levelRoles, k))
    // No role claims this plate type: putaway falls back to the SKU's own rule,
    // so naming a destination here would be a lie rather than a guess.
    return dest.length > 0 ? `${noun} (usually → ${dest.join('/')})` : noun
  }

  const suppliers = useMemo<SupplierOption[]>(
    () => (supplierRows ?? []).map((s) => ({ id: s.id, name: s.name })),
    [supplierRows],
  )

  // Destination warehouses — only active sites can receive stock.
  const activeWarehouses = useMemo(
    () => (warehouseRows ?? []).filter((w) => w.isActive),
    [warehouseRows],
  )
  // Warehouse-role staff with an assigned home site are pinned to it
  // server-side: no location_id is sent and no picker is shown. Warehouse staff
  // with NO home site get the same picker as an Admin, or they would have no
  // way to choose a destination at all.
  const isLocked = currentUser.role === UserRole.WAREHOUSE && currentUser.homeWarehouseId != null

  // ── Delivery ───────────────────────────────────────────────────────────────
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [reference, setReference] = useState('')
  // Not submitted directly: ticking it writes `quarantine` onto every line, so
  // what is ticked in the lines IS what is sent.
  const [quarantineAll, setQuarantineAll] = useState(false)
  const [receivedDate, setReceivedDate] = useState(todayIso())
  const [destinationId, setDestinationId] = useState<number | null>(null)

  // Seed the destination once the warehouse list arrives, and re-resolve if the
  // chosen site later drops out of the active list. Locked users don't pick.
  useEffect(() => {
    if (isLocked || activeWarehouses.length === 0) return
    const stillValid = destinationId != null && activeWarehouses.some((w) => w.id === destinationId)
    if (stillValid) return
    setDestinationId(resolveReceiveDestination(activeWarehouses, currentUser.homeWarehouseId))
  }, [activeWarehouses, currentUser.homeWarehouseId, destinationId, isLocked])

  const homeName = useMemo(
    () => activeWarehouses.find((w) => w.id === currentUser.homeWarehouseId)?.name,
    [activeWarehouses, currentUser.homeWarehouseId],
  )
  const destName = isLocked
    ? homeName
    : activeWarehouses.find((w) => w.id === destinationId)?.name

  // ── Staged lines and plates ────────────────────────────────────────────────
  // One state object, updated only through functional updates: lines name their
  // plate by key, and `receive-stock` rejects the WHOLE receipt on a plate_key
  // it was not given. Two scans landing in one React batch must each see the
  // other's plate, which two separate useStates updated side by side did not
  // guarantee.
  // `touchedKey` rides in the same object, so the line a scan counted on is
  // named by the very update that counted it — not by a second setState fired
  // from inside an updater, which React may run twice.
  // `touchSeq` changes on EVERY stage, so a second scan of the same line
  // re-arms the flash and the reveal; keyed on the line alone it would not.
  const [staging, setStaging] = useState<StagingState & { touchedKey: string | null; touchSeq: number }>(
    () => ({ ...emptyStaging(), touchedKey: null, touchSeq: 0 }),
  )
  const { lines: picked, plates, activeGroupKey, forceNewPallet, touchedKey, touchSeq } = staging
  const [received, setReceived] = useState<ReceivedSummary | null>(null)
  // Our own flag, set BEFORE the await: the mutation's `isPending` only flips
  // on the next render, which leaves a window for a double press or a scan.
  const [submitting, setSubmitting] = useState(false)
  const saving = submitting || receive.isPending

  useEffect(() => {
    if (!touchedKey) return
    const el = document.querySelector(`[data-line-key="${touchedKey}"]`) as HTMLElement | null
    if (el) revealBesideDock(el)
    const timer = setTimeout(() => setStaging((prev) => ({ ...prev, touchedKey: null })), TOUCH_FLASH_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touchSeq])

  const productById = useMemo(() => {
    const m = new Map<number, Product>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  // ── Search ─────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [scanNote, setScanNote] = useState<string | null>(null)
  const { flash, signal: signalFlash } = useScanFlash()

  // A delivery only ever contains the delivering supplier's items, so once an
  // EXISTING supplier is picked the picker narrows to their catalogue (mig
  // 00070). Soft: `showAllProducts` widens it back, because a product whose
  // supplier link hasn't been set up must never block a receipt.
  const [showAllProducts, setShowAllProducts] = useState(false)
  const isFiltered = supplierId != null && !showAllProducts
  // "Show all" is a per-delivery escape hatch, not a sticky preference.
  useEffect(() => { setShowAllProducts(false) }, [supplierId])

  const supplierProducts = useMemo(
    () => (supplierId != null ? productsForSupplier(products, supplierId) : products),
    [products, supplierId],
  )
  const searchPool = isFiltered ? supplierProducts : products

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return searchPool.filter((p) => matchesProductQuery(p, q, supplierId)).slice(0, 8)
  }, [searchPool, search, supplierId])

  // A new result list resets the highlight; a stale index would point Enter at
  // whatever happens to sit in that slot now.
  useEffect(() => { setActiveIndex(-1) }, [searchResults])

  // Only computed when the filtered search came up empty, to offer a one-click
  // widen instead of a dead end.
  const wouldMatchOutsideSupplier = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || !isFiltered || searchResults.length > 0) return false
    return products.some((p) => matchesProductQuery(p, q, supplierId))
  }, [products, search, isFiltered, searchResults.length, supplierId])

  // ScanField exposes no ref, so reach the input through the wrapper we own.
  // For pointer/keyboard flows only — a gun does not need focus on a desk,
  // because `useWedgeScanner` captures regardless of where it sits.
  const searchWrapRef = useRef<HTMLDivElement | null>(null)
  const focusSearch = () => { searchWrapRef.current?.querySelector('input')?.focus() }

  // ── Adding ─────────────────────────────────────────────────────────────────
  const addProduct = (product: Product) => {
    // A scan during the save would count onto a line the server has already
    // been sent, and the reset that follows would then discard it.
    if (saving) {
      setScanNote('Saving the receipt — scan that again in a moment.')
      signalFlash('reject')
      return
    }
    setStaging((prev) => {
      const result = stageProduct(prev, product, { quarantine: quarantineAll })
      return { ...result.state, touchedKey: result.touchedLineKey, touchSeq: prev.touchSeq + 1 }
    })
    setSearch('')
    setScanNote(null)
  }

  const pickFromSearch = (product: Product) => {
    addProduct(product)
    focusSearch()
  }

  /** Start a mixed pallet and point everything that follows at it. */
  const addMixedPallet = () => {
    const plate = newMixedPlate()
    setStaging((prev) => ({
      ...prev,
      plates: [...prev.plates, plate],
      activeGroupKey: plate.key,
      forceNewPallet: false,
    }))
    focusSearch()
  }

  const toggleNewPallet = () => {
    setStaging((prev) => ({ ...prev, forceNewPallet: !prev.forceNewPallet, activeGroupKey: null }))
    focusSearch()
  }

  const addBlankLine = () => {
    const plate = newPlate()
    setStaging((prev) => ({
      ...prev,
      plates: [...prev.plates, plate],
      lines: [...prev.lines, newDraft(plate.key, quarantineAll)],
    }))
  }

  /** Remove a mixed pallet and everything on it — the goods left together. */
  const removePlate = (plateKey: string) => {
    setStaging((prev) => ({
      ...prev,
      lines: prev.lines.filter((l) => l.plateKey !== plateKey),
      plates: prev.plates.filter((p) => p.key !== plateKey),
      activeGroupKey: prev.activeGroupKey === plateKey ? null : prev.activeGroupKey,
    }))
  }

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setStaging((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    }))
  }

  const removeLine = (key: string) => {
    setStaging((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.key !== key) }))
  }

  // A normal line owns its plate one-for-one. A mixed pallet is a pallet by
  // definition, and nothing on this screen may argue otherwise.
  const setPlateType = (plateKey: string, huType: 'pallet' | 'carton') => {
    setStaging((prev) => ({
      ...prev,
      plates: prev.plates.map((p) => (p.key === plateKey && !p.mixed ? { ...p, huType } : p)),
    }))
  }

  const setQuarantine = (next: boolean) => {
    setQuarantineAll(next)
    setStaging((prev) => ({ ...prev, lines: prev.lines.map((l) => ({ ...l, quarantine: next })) }))
  }

  // ── Scanning ───────────────────────────────────────────────────────────────
  // The index is built over the FULL catalogue, never `searchPool`: refusing a
  // scanned carton because a supplier link has not been configured would block
  // a real delivery for a data-entry reason.
  const scanIndex = useMemo(
    () => buildScanIndex({
      products: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, barcode: p.barcode ?? null })),
    }),
    [products],
  )

  // Site roots only — this is what lets a warehouse be told from a bin without
  // a second query, since both are `locations` rows.
  const warehouseIdByCode = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of activeWarehouses) m.set(normalizeScan(w.code), w.id)
    return m
  }, [activeWarehouses])

  /** True when the code was taken; false when it was refused (note set). */
  const handleDockScan = (raw: string): boolean => {
    const target = resolveReceiveScan(raw, scanIndex, warehouseIdByCode)

    if (target.kind === 'product') {
      const product = productById.get(target.product.id)
      if (product) {
        if (saving) {
          addProduct(product) // refuses and says why
          return false
        }
        addProduct(product)
        signalFlash('ok')
        return true
      }
    }

    if (target.kind === 'warehouse' && !isLocked) {
      setDestinationId(target.warehouseId)
      setScanNote(null)
      signalFlash('ok')
      return true
    }

    setScanNote(describeReceiveRefusal(target))
    signalFlash('reject')
    return false
  }

  // Enter in the search box. An exact code wins; failing that, a search that
  // narrowed to ONE product means that product — typing "nood" + Enter should
  // not be refused as an unknown barcode when the screen shows one match.
  const handleFieldScan = (raw: string) => {
    const target = resolveReceiveScan(raw, scanIndex, warehouseIdByCode)
    if (target.kind !== 'product' && target.kind !== 'warehouse' && searchResults.length === 1) {
      pickFromSearch(searchResults[0])
      if (!saving) signalFlash('ok')
      return
    }
    handleDockScan(raw)
  }

  // The desktop safety net: focus is often in a quantity or date box when the
  // next carton is scanned, and this catches it anyway.
  useWedgeScanner({ active: received == null && !saving, onScan: handleDockScan })

  // ── Derived ────────────────────────────────────────────────────────────────
  const mixedPlates = useMemo(() => plates.filter((p) => p.mixed), [plates])
  const looseLines = useMemo(
    () => picked.filter((l) => !mixedPlates.some((p) => p.key === l.plateKey)),
    [picked, mixedPlates],
  )

  const missingByLine = useMemo(
    () => new Map(picked.map((l) => [l.key, missingRequired(l, requirementFor(l.productId))])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, requirements],
  )

  const validLines = useMemo(
    () => picked.filter((l) => {
      const missing = missingByLine.get(l.key)
      return l.productId != null && Number(l.quantity) > 0 && !missing?.lot && !missing?.expiry
    }),
    [picked, missingByLine],
  )

  const totals = useMemo<ReceiveTotals>(() => {
    const staged = picked.filter((l) => l.productId != null)
    let missingLot = 0
    let missingExpiry = 0
    for (const l of staged) {
      const m = missingByLine.get(l.key)
      if (m?.lot) missingLot += 1
      if (m?.expiry) missingExpiry += 1
    }
    return {
      lines: staged.length,
      units: unitsSummary(staged, productById),
      plates: new Set(staged.map((l) => l.plateKey)).size,
      missingLot,
      missingExpiry,
    }
  }, [picked, productById, missingByLine])

  const hasSupplier = supplierId != null || supplierName.trim() !== ''
  // Locked users always have a server-derived destination; otherwise one must be
  // resolved unless no site is active (then the server routes to the default).
  const hasDestination = isLocked || destinationId != null || activeWarehouses.length === 0
  // Any staged line still missing a required lot/expiry blocks the WHOLE
  // receipt. Sending only the complete lines would let the reset that follows
  // wipe the incomplete ones — goods on the dock that never reach stock.
  const anyMissingRequired = totals.missingLot + totals.missingExpiry > 0
  const canSubmit =
    hasSupplier && hasDestination && validLines.length > 0 && !anyMissingRequired && !saving
  const blockedReason = !hasSupplier && picked.length > 0
    ? 'Choose a supplier to receive'
    : anyMissingRequired
      ? 'Fill the required lot / expiry to receive'
      : requirementsFailed
        ? 'Could not load which products need a lot or expiry — check those by hand'
        : null

  // ── Submit ─────────────────────────────────────────────────────────────────
  const resetReceipt = () => {
    setStaging((prev) => ({ ...emptyStaging(), touchedKey: null, touchSeq: prev.touchSeq }))
    setReference('')
    setQuarantineAll(false)
    setSupplierId(null)
    setSupplierName('')
  }

  const submit = async () => {
    if (!canSubmit) return
    const header: ReceiptHeader = {
      ...(supplierId != null ? { supplier_id: supplierId } : { supplier_name: supplierName.trim() }),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(receivedDate ? { received_date: receivedDate } : {}),
      // Locked users omit location_id so the server routes to their home site.
      ...(!isLocked && destinationId != null ? { location_id: destinationId } : {}),
    }
    const lines: ReceiptLine[] = validLines.map((l) => ({
      product_id: l.productId as number,
      quantity: Number(l.quantity),
      ...(l.uomId != null ? { uom_id: l.uomId } : {}),
      ...(l.lotCode.trim() ? { lot_code: l.lotCode.trim() } : {}),
      ...(l.expiryDate ? { expiry_date: l.expiryDate } : {}),
      ...(l.barcode.trim() ? { barcode: l.barcode.trim() } : {}),
      plate_key: l.plateKey,
      ...(l.quarantine ? { quarantine: true } : {}),
    }))
    // Only plates carrying a VALID line: an empty plate is rejected server-side.
    const platePayload: ReceiptPlate[] = plates
      .filter((p) => validLines.some((l) => l.plateKey === p.key))
      .map((p) => ({ key: p.key, hu_type: p.huType }))
    setSubmitting(true)
    try {
      const result = await receive.mutateAsync({ header, lines, plates: platePayload })
      addToast(`Received ${result.lines_received} line${result.lines_received === 1 ? '' : 's'} into stock`, 'success')
      const recommendations: PutawayLineRecommendation[] =
        result.putaway?.mode === 'engine' ? result.putaway.recommendations : []
      setReceived({
        receiptId: result.receipt_id ?? null,
        linesReceived: result.lines_received,
        units: unitsSummary(validLines, productById),
        destName,
        warehouseId: result.location_id ?? null,
        recommendations,
      })
      resetReceipt()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to receive stock', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const startNextDelivery = () => {
    setReceived(null)
    // The strip is open again with an empty supplier; put the cursor there.
    requestAnimationFrame(() => {
      ;(document.querySelector('input[aria-label="Supplier"]') as HTMLInputElement | null)?.focus()
    })
  }

  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])

  const scope = (
    <>
      {supplierId != null && (
        <p className="text-xs text-stone-600">
          {isFiltered ? (
            <>
              Showing {supplierProducts.length} product{supplierProducts.length === 1 ? '' : 's'} from{' '}
              <span className="text-stone-700">{supplierName}</span>.{' '}
              <button
                type="button"
                onClick={() => setShowAllProducts(true)}
                className="text-nexgen-blue-dark hover:underline"
              >
                Show all products
              </button>
            </>
          ) : (
            <>
              Showing all products.{' '}
              <button
                type="button"
                onClick={() => setShowAllProducts(false)}
                className="text-nexgen-blue-dark hover:underline"
              >
                Only {supplierName}’s products
              </button>
            </>
          )}
        </p>
      )}
      {wouldMatchOutsideSupplier && (
        <p className="text-xs text-amber-700">
          No match in {supplierName}’s products.{' '}
          <button type="button" onClick={() => setShowAllProducts(true)} className="font-medium hover:underline">
            Search all products
          </button>
        </p>
      )}
    </>
  )

  return (
    // A flex column so the scan bar can be the LAST item below `lg` (a bottom
    // dock must be — see StickyScanBar) while sitting right under the delivery
    // strip in the DOM, which is where it belongs on a desk and in focus order.
    <div className="bg-white min-h-svh p-4 sm:p-6 xl:p-8 flex flex-col gap-4 sm:gap-5">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-nexgen-blue/10">
          <PackagePlus className="w-5 h-5 text-nexgen-blue" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-stone-900">Receive Stock</h1>
          <p className="text-xs text-stone-600 mt-0.5">
            Pick the supplier, then scan each carton. Scanning the same product again counts it.
          </p>
        </div>
      </div>

      {received ? (
        <ReceiveSuccessCard
          summary={received}
          productNameById={productNameById}
          onOpenPutaway={onOpenPutaway}
          onStartNext={startNextDelivery}
        />
      ) : (
        <>
          <DeliveryStrip
            suppliers={suppliers}
            supplierId={supplierId}
            supplierName={supplierName}
            onSupplierText={(name) => { setSupplierName(name); setSupplierId(null) }}
            onSupplierPicked={({ id, name }) => {
              setSupplierId(id)
              setSupplierName(name)
              // Straight to the scan field: the next thing anyone does is scan.
              requestAnimationFrame(focusSearch)
            }}
            reference={reference}
            onReference={setReference}
            receivedDate={receivedDate}
            maxDate={todayIso()}
            onReceivedDate={setReceivedDate}
            quarantineAll={quarantineAll}
            onQuarantineAll={setQuarantine}
            isLocked={isLocked}
            warehouses={activeWarehouses}
            destinationId={destinationId}
            onDestination={setDestinationId}
            destName={destName}
            userName={currentUser.name}
          />

          {/* `bleed="xl"` because THIS page pads `p-4 sm:p-6 xl:p-8`. The order
              classes go on the bar ITSELF: a wrapper would become sticky's
              containing block, exactly the bar's height, and it would never pin. */}
          <StickyScanBar bleed="xl" position="adaptive" className="order-last mt-auto lg:order-none lg:mt-0">
              <ReceiveWorkBar
                searchWrapRef={searchWrapRef}
                search={search}
                onSearch={(v) => { setSearch(v); if (scanNote) setScanNote(null) }}
                onFieldScan={handleFieldScan}
                flash={flash}
                scanNote={scanNote}
                placeholder={
                  isFiltered
                    ? `Scan a carton, or search ${supplierName}’s products…`
                    : 'Scan a carton, or search by name, SKU or barcode…'
                }
                results={searchResults}
                supplierId={supplierId}
                activeIndex={activeIndex}
                onActiveIndex={setActiveIndex}
                onPick={pickFromSearch}
                scope={scope}
                forceNewPallet={forceNewPallet}
                onToggleNewPallet={toggleNewPallet}
                onMixedPallet={addMixedPallet}
                onAddBlankLine={addBlankLine}
                totals={totals}
                canSubmit={canSubmit}
                isPending={saving}
                validCount={validLines.length}
                blockedReason={blockedReason}
                onSubmit={submit}
              />
          </StickyScanBar>

          {picked.length === 0 && mixedPlates.length === 0 ? (
            <div className="glass-panel shadow-card rounded-2xl p-8 sm:p-10 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-nexgen-blue/10 text-nexgen-blue">
                <ScanLine className="h-7 w-7" aria-hidden="true" />
              </div>
              <h2 className="text-lg font-semibold text-stone-900">Scan the first carton</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">
                Each scan adds one carton; scan it again to count it up. Use{' '}
                <span className="font-semibold">New pallet</span> to start a separate pallet of the same product,
                or <span className="font-semibold">Mixed pallet</span> for a pallet with several products.
              </p>
            </div>
          ) : (
            /* `@container` is declared HERE, on the one element that wraps both
               the column headings and every row, so the two can never disagree
               about which layout is showing. The row needs 1180px of CONTAINER
               — see the measurement table in `ReceiveLineCard`. A plain block
               comment: this sits directly inside a ternary branch. */
            // No `overflow-hidden`: a hand-added line opens a product list that
            // must be able to leave the card. `relative z-[1]` because the
            // card's backdrop-blur is a stacking context — without the lift the
            // Recent receipts card below paints over that list. Still under the
            // sticky scan bar's z-10.
            <div className="@container glass-card rounded-xl relative z-[1]">
              <div
                className={`hidden border-b border-stone-200 px-4 py-3 @min-[1180px]:grid @min-[1180px]:gap-x-4 ${RECEIVE_ROW_COLUMNS}`}
              >
                {['Product', 'Qty', 'Lot code', 'Expiry', 'Barcode', 'Arrived on', 'Hold', ''].map(
                  (heading, i) => (
                    <span
                      key={heading || `spacer-${i}`}
                      className={`text-xs font-semibold uppercase tracking-wider text-stone-600 ${
                        heading === 'Qty' ? 'text-right' : heading === 'Hold' ? 'text-center' : 'text-left'
                      }`}
                    >
                      {heading}
                    </span>
                  ),
                )}
              </div>

              <div className="divide-y divide-stone-100">
                {/* Mixed pallets first: they are containers, and one sorted in
                    among its own contents would read as one more line. */}
                {mixedPlates.map((plate) => (
                  <React.Fragment key={plate.key}>
                    <MixedPalletCard
                      plate={plate}
                      label={plateLabel(plates, plate.key)}
                      lines={picked.filter((l) => l.plateKey === plate.key)}
                      productById={productById}
                      supplierId={supplierId}
                      plateDestinationLabel={plateDestinationLabel}
                      palletSpec={palletSpec}
                      active={activeGroupKey === plate.key}
                      onAddItem={() => {
                        setStaging((prev) => ({ ...prev, activeGroupKey: plate.key, forceNewPallet: false }))
                        focusSearch()
                      }}
                      onDone={() => setStaging((prev) => ({ ...prev, activeGroupKey: null }))}
                      onRemove={() => removePlate(plate.key)}
                      onUpdateLine={updateLine}
                      onRemoveLine={removeLine}
                      requirementFor={requirementFor}
                      highlightedKey={touchedKey}
                    />
                  </React.Fragment>
                ))}
                {looseLines.map((line) => (
                  // `key` on a typed local component is a type error here (no
                  // @types/react); Fragment carries it — CLAUDE.md, "Types gotcha".
                  <React.Fragment key={line.key}>
                    <ReceiveLineCard
                      line={line}
                      product={line.productId != null ? productById.get(line.productId) : undefined}
                      supplierId={supplierId}
                      plates={plates}
                      plateDestinationLabel={plateDestinationLabel}
                      palletSpec={palletSpec}
                      onUpdate={(patch) => updateLine(line.key, patch)}
                      onRemove={() => removeLine(line.key)}
                      onSetPlateType={(huType) => setPlateType(line.plateKey, huType)}
                      requirement={requirementFor(line.productId)}
                      highlighted={touchedKey === line.key}
                      productPool={searchPool}
                      onChooseProduct={(p) => updateLine(line.key, {
                        productId: p.id,
                        uomId: scanUomFor(p)?.id ?? null,
                        quantity: line.quantity || '1',
                      })}
                    />
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <RecentReceiptsPanel />
    </div>
  )
}

export default ReceiveStockView
