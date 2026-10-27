// The putaway work list (NX-0007): everything still to carry, scan-first.
//
// Since NX-0006 a SUGGESTED task completes directly — the product's home bin is
// the plan — so this lists suggested tasks alongside any ASSIGNED ones still in
// flight from the old two-stage flow. Nobody claims a stop, so two people can
// work at once; wie_complete_putaway_tx's row lock makes the loser of a race get
// a clean "someone else already placed this" rather than a double transfer.
//
// Order: the engine's route where it has one (wie_putaway_stops covers ASSIGNED
// tasks only), then bin code, which runs by aisle and bay. See putawayStops.ts.
//
// Two modes, chosen per device by the page:
//   scan  — the scan bar opens whatever is scanned, already past "identify";
//   guide — one task at a time in walk order, with Skip.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Footprints, Layers, MapPin, PackageOpen, Search, SkipForward } from 'lucide-react'
import { useOpenPutaways, usePutawayRoute } from '../../hooks/queries/usePutawayWalk'
import { useWarehouseLocations } from '../../hooks/queries/useWarehouseLocations'
import { PutawayStopCard } from './putaway/PutawayStopCard'
import { PutawayScanFinder, type ScanEvidence } from './putaway/PutawayScanFinder'
import { combinePutawayStops, orderPutawayStops, targetBinId, type PutawayStop } from './putaway/putawayStops'
import { describeQuantity } from './putaway/putawayFormat'
import StickyScanBar from './StickyScanBar'
import { buildDisplayLookup, displayFor, searchTextFor } from '@/lib/locationLookup'
import type { DisplayLocation } from '@/lib/locationDisplay'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'

/** Stable identity for "no twins", so a card without any is not handed a fresh
 *  array on every render of the walk. */
const EMPTY_TWINS: ReadonlyArray<{ huCode: string; quantity: number }> = []
/** Guide mode opens each task at its normal first step. */
const OPEN_AT_START: ScanEvidence = {}

export type PutawayMode = 'scan' | 'guide'

interface PutawayWalkViewProps {
  warehouseId: number
  /** False for a Warehouse-role user looking at someone else's site. */
  canPlace?: boolean
  mode?: PutawayMode
  /** Only this delivery's lines (?receipt=, from "Put away now"). */
  receiptId?: number | null
}

interface Choice {
  evidence: ScanEvidence
  stops: PutawayStop[]
}

const PutawayWalkView: React.FC<PutawayWalkViewProps> = ({
  warehouseId, canPlace = true, mode = 'scan', receiptId = null,
}) => {
  const tasksQuery = useOpenPutaways(warehouseId)
  const routeQuery = usePutawayRoute(warehouseId)
  const locationsQuery = useWarehouseLocations(warehouseId)

  const [activeKey, setActiveKey] = useState<number | null>(null)
  const [opening, setOpening] = useState<{ key: number; evidence: ScanEvidence } | null>(null)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [skipped, setSkipped] = useState<number[]>([])
  const [search, setSearch] = useState('')

  // Bring the opened stop to the top of the SCREEN, not just the list: at
  // 360x664 an open card is the whole screen, and on the RS35 a scan only
  // reaches the focused field. `behavior: 'auto'` so reduced-motion is moot.
  const activeCardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (activeKey == null) return
    activeCardRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
  }, [activeKey])

  const binById = useMemo(() => buildDisplayLookup(locationsQuery.data), [locationsQuery.data])

  const allTasks = tasksQuery.data ?? []
  const tasks = useMemo(
    () => (receiptId == null ? allTasks : allTasks.filter((t) => t.receipt?.id === receiptId)),
    [allTasks, receiptId],
  )

  // The engine's walk sequence and the bin's LIVE code, for routed tasks. The
  // code from wie_putaway_stops wins over the cached location list, which is
  // five minutes stale at best and includes retired bins (see binFor).
  const routeById = useMemo(() => {
    const m = new Map<number, { sequence: number; legDistanceM: number; reachable: boolean; code: string }>()
    if (routeQuery.data?.mode === 'engine') {
      for (const s of routeQuery.data.stops) {
        m.set(s.recId, { sequence: s.sequence, legDistanceM: s.legDistanceM, reachable: s.reachable, code: s.code })
      }
    }
    return m
  }, [routeQuery.data])

  /** Where a task is going, name and code. Falls back to the id rather than
   *  rendering nothing: the goods exist whether or not the cached map does. */
  const binFor = useMemo(() => (row: PendingPutawayRow): DisplayLocation => {
    const target = targetBinId(row)
    const cached = displayFor(binById, target)
    const live = routeById.get(row.id)?.code
    if (live) {
      if (cached && cached.code !== live) return { code: live, name: null, isActive: cached.isActive }
      return cached ? { ...cached, code: live } : { code: live, name: null }
    }
    return cached ?? { code: target != null ? `#${target}` : 'No bin yet', name: null }
  }, [binById, routeById])

  const ordered = useMemo(
    () => orderPutawayStops(combinePutawayStops(tasks), {
      sequenceOf: (id) => routeById.get(id)?.sequence ?? null,
      codeOf: (binId) => (binId == null ? null : displayFor(binById, binId)?.code ?? null),
    }),
    [tasks, routeById, binById],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ordered
    return ordered.filter(({ lead }) => {
      const bin = searchTextFor(binFor(lead))
      return (
        (lead.product?.name ?? '').toLowerCase().includes(q) ||
        (lead.product?.sku ?? '').toLowerCase().includes(q) ||
        (lead.huCode ?? '').toLowerCase().includes(q) ||
        bin.includes(q)
      )
    })
  }, [ordered, search, binFor])

  // The stop being worked, hoisted to the top. Reorder the ARRAY, never move the
  // element: the card keeps its wizard in local state, and React only keeps an
  // instance across a reorder within one parent (putawayWalkPromotesActive).
  const walkOrder = useMemo(() => {
    const i = visible.findIndex((s) => s.key === activeKey)
    if (i <= 0) return visible
    return [visible[i], ...visible.slice(0, i), ...visible.slice(i + 1)]
  }, [visible, activeKey])

  // The OTHER unlabelled plates of the same product in this list: a product
  // barcode cannot say which of them is in the operator's hands.
  const twinsById = useMemo(() => {
    const m = new Map<number, Array<{ huCode: string; quantity: number }>>()
    const unlabelled = tasks.filter((t) => t.huCode && !t.huLabelPrinted)
    for (const row of unlabelled) {
      const twins = unlabelled
        .filter((t) => t.id !== row.id && t.productId === row.productId)
        .map((t) => ({ huCode: t.huCode as string, quantity: t.quantity }))
      if (twins.length > 0) m.set(row.id, twins)
    }
    return m
  }, [tasks])

  const stopOf = (taskId: number) => ordered.find((s) => s.taskIds.includes(taskId)) ?? null

  const open = (stop: PutawayStop, evidence: ScanEvidence) => {
    setChoice(null)
    setSearch('')
    setActiveKey(stop.key)
    setOpening({ key: stop.key, evidence })
  }

  const onFound = (taskId: number, evidence: ScanEvidence = {}) => {
    const stop = stopOf(taskId)
    if (stop) open(stop, evidence)
  }

  /** One scan, several stops — a mixed plate, or one product queued twice. */
  const onMany = (taskIds: number[], evidence: ScanEvidence) => {
    const stops = ordered.filter((s) => s.taskIds.some((id) => taskIds.includes(id)))
    if (stops.length === 1) return open(stops[0], evidence)
    setActiveKey(null)
    setChoice({ evidence, stops })
  }

  const closeStop = () => {
    setActiveKey(null)
    setOpening(null)
  }

  // ── Guide: one task at a time ─────────────────────────────────────────────
  const guideQueue = useMemo(() => ordered.filter((s) => !skipped.includes(s.key)), [ordered, skipped])
  const guideStop = mode === 'guide' ? guideQueue[0] ?? null : null

  const renderCard = (stop: PutawayStop, active: boolean, request: ScanEvidence | null) => {
    const routed = routeById.get(stop.lead.id)
    return (
      <PutawayStopCard
        row={stop.lead}
        bin={binFor(stop.lead)}
        sequence={routed?.sequence ?? null}
        legDistanceM={routed?.legDistanceM ?? null}
        reachable={routed?.reachable ?? true}
        active={active}
        disabled={!canPlace}
        warehouseId={warehouseId}
        unlabelledTwins={twinsById.get(stop.lead.id) ?? EMPTY_TWINS}
        openRequest={request}
        taskIds={stop.taskIds}
        onActivate={() => setActiveKey(stop.key)}
        onDone={closeStop}
      />
    )
  }

  const totalDistance = routeQuery.data?.mode === 'engine' ? routeQuery.data.totalDistanceM : null
  const showScanBar = mode === 'scan' && tasks.length > 0 && activeKey == null

  const body = tasksQuery.isLoading ? (
    <div className="glass-card rounded-xl divide-y divide-stone-100">
      {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse bg-stone-100/60" />)}
    </div>
  ) : tasksQuery.isError ? (
    <div className="glass-card rounded-xl p-8 text-center">
      <p className="text-sm text-red-600">Couldn't load the putaway list.</p>
      <p className="text-xs text-stone-600 mt-1">Check your connection and try again.</p>
    </div>
  ) : tasks.length === 0 ? (
    <div className="glass-card rounded-xl p-10 text-center">
      <PackageOpen className="w-9 h-9 text-stone-300 mx-auto mb-3" aria-hidden="true" />
      <p className="text-sm text-stone-700">Nothing to put away</p>
      <p className="text-xs text-stone-600 mt-1">Received stock shows up here, ready to scan.</p>
    </div>
  ) : mode === 'guide' ? (
    guideStop ? (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm text-stone-600">
          <span className="tabular-nums">
            {guideQueue.length} to go{skipped.length > 0 ? ` · ${skipped.length} skipped` : ''}
          </span>
          <button
            type="button"
            onClick={() => { setSkipped((k) => [...k, guideStop.key]); closeStop() }}
            className="touch-target-y inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 btn-press"
          >
            <SkipForward className="h-4 w-4" aria-hidden="true" /> Skip
          </button>
        </div>
        {/* Keyed by the stop, so the next task mounts a fresh card. */}
        <div key={guideStop.key} className="glass-card rounded-xl overflow-hidden">
          {renderCard(
            guideStop,
            true,
            opening?.key === guideStop.key ? opening.evidence : OPEN_AT_START,
          )}
        </div>
      </div>
    ) : (
      <div className="glass-card rounded-xl p-10 text-center">
        <p className="text-sm text-stone-700">Only skipped tasks are left</p>
        <button
          type="button"
          onClick={() => setSkipped([])}
          className="touch-target-y mt-3 inline-flex items-center gap-1.5 rounded-lg bg-nexgen-blue-dark px-4 py-2 text-sm font-semibold text-white btn-press"
        >
          Go through the {skipped.length} skipped
        </button>
      </div>
    )
  ) : visible.length === 0 ? (
    <div className="glass-card rounded-xl p-10 text-center">
      <p className="text-sm text-stone-700">No tasks match that filter</p>
      <p className="text-xs text-stone-600 mt-1">{tasks.length} still to put away.</p>
    </div>
  ) : (
    <div className="glass-card rounded-xl divide-y divide-stone-100 overflow-hidden">
      {walkOrder.map((stop, i) => (
        // The key rides on the wrapper, and the wrapper stays in this one array
        // — that is what makes hoisting a move rather than a remount.
        <div
          key={stop.key}
          ref={stop.key === activeKey ? activeCardRef : undefined}
          className="queue-in"
          style={{ '--q-i': i } as React.CSSProperties}
        >
          {renderCard(stop, activeKey === stop.key, opening?.key === stop.key ? opening.evidence : null)}
        </div>
      ))}
    </div>
  )

  return (
    // A flex column so the scan bar can sit high in the DOM (top on a desk, and
    // first in focus order) yet be the LAST item below `lg`, where it docks at
    // the bottom under the thumb. Same arrangement as Receive Stock (NX-0005).
    <div className="flex flex-col gap-4">
      {/* The scan bar. Hidden while a stop is open: the open card focuses its
          own scan field, and under the RS35's IME two live scan inputs is a coin
          toss over which one hears the gun. */}
      {showScanBar && (
        <StickyScanBar bleed="lg" position="adaptive" className="order-last mt-auto lg:order-none lg:mt-0">
          <PutawayScanFinder
            rows={tasks}
            locations={locationsQuery.data ?? []}
            binIdOf={targetBinId}
            onFound={onFound}
            onMany={onMany}
            onFilter={setSearch}
          />
        </StickyScanBar>
      )}

      {/* The overview stands down while a stop is open, for the same reason. */}
      {mode === 'scan' && tasks.length > 0 && activeKey == null && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-stone-600">
            <Footprints className="w-4 h-4 text-nexgen-blue" aria-hidden="true" />
            <span className="tabular-nums font-medium">{ordered.length}</span>
            <span>to put away</span>
            {totalDistance != null && totalDistance > 0 && (
              <>
                <span className="text-stone-400" aria-hidden="true">·</span>
                <span className="tabular-nums">{Math.round(totalDistance)}m routed</span>
              </>
            )}
          </div>
          <div className="relative flex-1 min-w-0 sm:max-w-xs sm:ml-auto">
            <Search className="w-4 h-4 text-stone-600 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by product, plate or bin"
              aria-label="Filter the putaway list"
              className="touch-target-y w-full pl-9 pr-3 py-2 rounded-lg border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue-dark focus:border-nexgen-blue"
            />
          </div>
        </div>
      )}

      {mode === 'scan' && activeKey == null && routeQuery.data?.mode === 'engine' && routeQuery.data.unreachableCount > 0 && (
        <p className="text-xs text-amber-700 flex items-start gap-1.5">
          <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {routeQuery.data.unreachableCount} bin
          {routeQuery.data.unreachableCount === 1 ? ' is' : 's are'} not placed in the current layout, so
          {routeQuery.data.unreachableCount === 1 ? ' it' : ' they'} could not be routed — listed last.
        </p>
      )}

      {/* One scan, several things it could be: say so and let the operator pick.
          Scanning a product off the plate works too — the scan bar stays live. */}
      {mode === 'scan' && choice && activeKey == null && (
        <div className="glass-card rounded-xl p-4 space-y-3" role="group" aria-label="Choose what to put away">
          <p className="flex items-center gap-2 text-sm font-semibold text-stone-900">
            <Layers className="h-4 w-4 text-nexgen-blue-dark" aria-hidden="true" />
            {choice.evidence.plateCode
              ? `${choice.evidence.plateCode} holds ${choice.stops.length} products — scan or pick one`
              : `${choice.stops.length} tasks match — scan or pick one`}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {choice.stops.map((stop) => {
              const qty = describeQuantity(stop.lead.quantity, stop.lead.product)
              return (
                <button
                  key={stop.key}
                  type="button"
                  onClick={() => open(stop, choice.evidence)}
                  className="touch-target-y flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-left btn-press hover:bg-stone-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-stone-900">
                      {stop.lead.product?.name ?? `Product #${stop.lead.productId}`}
                    </span>
                    <span className="block font-mono text-xs text-stone-600">{binFor(stop.lead).code}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-stone-700">{qty.primary}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => setChoice(null)}
            className="touch-target-y text-xs text-stone-600 hover:text-stone-900"
          >
            Cancel
          </button>
        </div>
      )}

      {/* While the operator is choosing between a plate's products, the list
          steps aside: the choice IS the list for that moment. */}
      {!(mode === 'scan' && choice && activeKey == null) && body}
    </div>
  )
}

export default PutawayWalkView
