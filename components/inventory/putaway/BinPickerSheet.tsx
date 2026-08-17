// "Put it somewhere else" for one queued putaway line.
//
// Three ways in, cheapest first: the engine's own runner-up bins as one-tap
// chips, a search over every bin in the warehouse, or a typed/scanned bin code.
// Quantity defaults to the whole line but can be reduced — the remainder stays
// on the queue (mig 00071).
//
// Rule violations are shown, never enforced: the operator is standing in front
// of the rack and the server accepts any active bin in this warehouse. One
// rule gets special handling — a rack level's `levelRole` (mig 00072) is a
// HARD rule at recommendation time, so choosing a mismatched level here is a
// deliberate override: the confirm button becomes "Place anyway" and the
// caller must forward `roleOverride` to decide-putaway as `role_override:
// true` so the exception is audited server-side.

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, MapPin, Search } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { ScanField } from '@/components/ui/ScanField'
import { normalizeScan } from '@/lib/scan/resolveScan'
import { useScanFlash } from '@/lib/scan/useScanFlash'
import { useWarehouseLocations } from '@/hooks/queries/useWarehouseLocations'
import { useBalancesByWarehouse } from '@/hooks/queries/useInventoryBalances'
import { useLevelRoles } from '@/hooks/queries/useLevelRoles'
import { roleLabel } from '@/lib/levelRoles'
import { useZoneProfiles } from '@/hooks/queries/useZoneProfiles'
import { getWmsAttributes } from '@/services/supabase/wmsAttributesService'
import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'
import type { InventoryLocation, LevelRole, ProductWmsAttributes } from '@/types'
import { binFillFromBalances, evaluateBinWarnings, isLevelRoleMismatch, resolveZoneProfileId } from './putawayGuards'
import { baseUnitLabel, describeQuantity, toBaseQty, trimNumber, uomsForProduct } from './putawayFormat'
import { locationSubtitle, locationTitle } from '@/lib/locationDisplay'

interface BinPickerSheetProps {
  open: boolean
  warehouseId: number
  row: PendingPutawayRow
  busy?: boolean
  onClose: () => void
  /** `roleOverride` is true when the chosen bin is a rack level whose role this
   *  SKU doesn't allow — the caller must forward it to decide-putaway as
   *  `role_override: true` so the server records the exception (mig 00072). */
  onConfirm: (chosenLocationId: number, baseQty: number, roleOverride: boolean) => void
}

// `product_wms_attributes.allowed_level_roles` (mig 00072) isn't on
// ProductWmsAttributes / the wmsAttributesService payload yet — read it
// defensively so this sheet works today and picks the field up for free once
// the type/service/adapter land it. Empty/absent = unconstrained (any role).
type WmsAttributesWithLevelRoles = ProductWmsAttributes & { allowedLevelRoles?: LevelRole[] | null }

// Storage nodes stock can actually be dropped into. STAGING/WAREHOUSE are
// reachable by typing a code, and warned about rather than hidden — an operator
// who really did leave it on the dock should be able to say so.
const STORAGE_KINDS = new Set(['BIN', 'SHELF', 'RACK', 'BAY'])

const fieldCls =
  'w-full pl-9 pr-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30'

export function BinPickerSheet({ open, warehouseId, row, busy, onClose, onConfirm }: BinPickerSheetProps) {
  const locationsQuery = useWarehouseLocations(open ? warehouseId : null)
  const balancesQuery = useBalancesByWarehouse(open ? warehouseId : null)
  const { data: zoneProfiles } = useZoneProfiles()
  // Operator-managed role vocabulary (mig 00081), so every role in this sheet
  // reads the way it does everywhere else ("Pick Zone", not "pick").
  const { data: levelRoles = [] } = useLevelRoles()
  // Per-base-unit weight (product_wms_attributes). Shares its cache key with
  // ProductWmsAttributesSection so the admin form and this picker agree.
  const { data: wms } = useQuery({
    queryKey: ['wms-attributes', row.productId],
    queryFn: () => getWmsAttributes(row.productId),
    enabled: open,
  })
  const allowedLevelRoles = (wms as WmsAttributesWithLevelRoles | null | undefined)?.allowedLevelRoles ?? null

  const [chosenId, setChosenId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [code, setCode] = useState('')
  const [count, setCount] = useState('')
  const [uomId, setUomId] = useState<number | null>(null)
  const { flash, signal: signalFlash } = useScanFlash()

  const uoms = useMemo(() => uomsForProduct(row.product), [row.product])
  const selectedUom = useMemo(
    () => uoms.find((u) => u.id === uomId) ?? uoms.find((u) => u.isBase) ?? uoms[0],
    [uoms, uomId],
  )
  const unitLabel = baseUnitLabel(row.product)

  // Re-seed whenever the sheet opens for a (possibly different) row: default to
  // the whole line in base units so the common case is one tap.
  useEffect(() => {
    if (!open) return
    setChosenId(null)
    setSearch('')
    setCode('')
    setUomId(null)
    setCount(trimNumber(row.quantity))
  }, [open, row.id, row.quantity])

  const locations = locationsQuery.data ?? []
  const locationsById = useMemo(() => {
    const m = new Map<number, InventoryLocation>()
    for (const l of locations) m.set(l.id, l)
    return m
  }, [locations])
  // Each bin is counted in its own unit, so the fill needs the locations
  // (for slot_kind) alongside the balances — see mig 00078.
  const fill = useMemo(
    () => binFillFromBalances(balancesQuery.data, locationsById),
    [balancesQuery.data, locationsById],
  )

  const storageBins = useMemo(
    () => locations.filter((l) => l.isActive && STORAGE_KINDS.has(l.kind)),
    [locations],
  )

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    const pool = q
      ? storageBins.filter((b) =>
          b.code.toLowerCase().includes(q) ||
          b.name.toLowerCase().includes(q) ||
          b.materializedPath.toLowerCase().includes(q))
      : storageBins
    return pool.slice(0, 60)
  }, [storageBins, search])

  // A typed or scanned code resolves against every active location, including
  // staging — locations.code is globally unique, so an exact match is safe.
  //
  // Folded with `normalizeScan`, NOT `toLowerCase`. A wedge gun can append a
  // NUL or a zero-width mark that `String.trim()` leaves in place, and the
  // effect of comparing those raw was that a perfectly good label read as "No
  // active location with that code" — the operator's own eyes disagreeing with
  // the screen, with nothing on screen to explain it.
  const typedCode = normalizeScan(code)
  const typedMatch = useMemo(
    () => (typedCode ? locations.find((l) => l.isActive && normalizeScan(l.code) === typedCode) : undefined),
    [locations, typedCode],
  )
  useEffect(() => {
    if (typedMatch) setChosenId(typedMatch.id)
  }, [typedMatch])

  const chosen = chosenId != null ? locationsById.get(chosenId) : undefined
  const baseQty = toBaseQty(Number(count), selectedUom)
  const remainder = row.quantity - baseQty

  const zoneProfile = useMemo(() => {
    if (!chosen) return null
    const id = resolveZoneProfileId(chosen, locationsById)
    return (zoneProfiles ?? []).find((z) => z.id === id) ?? null
  }, [chosen, locationsById, zoneProfiles])

  const warnings = useMemo(() => {
    if (!chosen || baseQty <= 0) return []
    return evaluateBinWarnings({
      bin: chosen,
      zoneProfile,
      product: row.product,
      baseQty,
      usedSlots: fill.get(chosen.id) ?? 0,
      unitWeightKg: wms?.weightKg ?? null,
      allowedLevelRoles,
      huType: row.huType,
      levelRoles,
    })
  }, [chosen, zoneProfile, row.product, row.huType, baseQty, fill, wms, allowedLevelRoles, levelRoles])

  const qtyError =
    baseQty <= 0
      ? 'Enter how much you are putting away.'
      : baseQty > row.quantity
        ? `Only ${trimNumber(row.quantity)} ${unitLabel} left on this line.`
        : null

  const canConfirm = chosen != null && qtyError == null && !busy
  const alternatives = row.explanation?.alternatives ?? []
  // The row was already unplaceable when the operator opened this sheet — the
  // engine found no compatible level for the whole queued quantity. Dismissing
  // without picking a bin genuinely means "leave it queued", not just "cancel".
  const isWedged = row.recommendedLocationId == null
  const roleOverride = isLevelRoleMismatch(chosen, allowedLevelRoles)

  const submit = () => {
    if (!canConfirm || chosen == null) return
    onConfirm(chosen.id, baseQty, roleOverride)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      width="md"
      mobile="bottom"
      dirty={chosenId != null}
      discardConfirm={{
        title: 'Discard this bin choice?',
        message: 'The line stays in the queue and nothing moves.',
        confirmLabel: 'Discard',
      }}
      icon={<MapPin className="w-5 h-5 text-emerald-600" />}
      title="Choose a bin"
      description={`${row.product?.name ?? `Product #${row.productId}`} · ${describeQuantity(row.quantity, row.product).primary} waiting`}
      footer={({ requestClose }) => (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={requestClose}
            className="text-sm px-3 py-2 rounded-lg border border-stone-200 text-stone-600 btn-press"
          >
            {isWedged ? 'Leave queued' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canConfirm}
            className={`inline-flex items-center gap-1.5 text-sm px-3.5 py-2 text-white rounded-lg btn-press disabled:opacity-40 ${
              roleOverride ? 'bg-amber-600' : 'bg-emerald-600'
            }`}
          >
            {busy ? 'Putting away…' : roleOverride ? 'Place anyway' : 'Put here'} <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    >
      <div className="space-y-5">
        {/* Wedge banner: the engine found nothing compatible for this line at all. */}
        {isWedged && row.explanation?.hardFilters?.some((h) => h.code === 'level_role_mismatch') && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-xs">
              {row.explanation.hardFilters.find((h) => h.code === 'level_role_mismatch')!.label}. Pick a bin below and
              confirm with <span className="font-medium">Place anyway</span> to override — it's recorded — or leave
              this queued for another level to free up.
            </p>
          </div>
        )}
        {/* Quantity ------------------------------------------------------- */}
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">How much</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-28 px-3 py-2 rounded-lg border border-stone-200 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-nexgen-blue/30"
              aria-label="Quantity to put away"
            />
            {uoms.length > 1 && (
              <select
                value={selectedUom?.id ?? ''}
                onChange={(e) => {
                  const next = uoms.find((u) => u.id === Number(e.target.value))
                  setUomId(next && !next.isBase ? next.id : null)
                }}
                className="px-2.5 py-2 rounded-lg border border-stone-200 bg-white text-sm"
                aria-label="Unit"
              >
                {uoms.map((u) => (
                  <option key={`${u.id}-${u.code}`} value={u.id}>
                    {u.code}{u.isBase ? '' : ` (×${u.factorToBase})`}
                  </option>
                ))}
              </select>
            )}
            <span className="text-xs text-stone-400 tabular-nums">
              = {trimNumber(baseQty)} {unitLabel}
            </span>
          </div>
          {qtyError ? (
            <p className="text-xs text-red-600 mt-1.5">{qtyError}</p>
          ) : remainder > 0 ? (
            <p className="text-xs text-amber-600 mt-1.5">
              {trimNumber(remainder)} {unitLabel} stay in the queue for another bin.
            </p>
          ) : null}
        </div>

        {/* Engine alternates ---------------------------------------------- */}
        {alternatives.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-stone-600 mb-1.5">The engine's next-best bins</p>
            <div className="flex flex-wrap gap-1.5">
              {alternatives.map((a) => (
                <button
                  key={a.locationId}
                  type="button"
                  onClick={() => { setChosenId(a.locationId); setCode('') }}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border btn-press font-mono ${
                    chosenId === a.locationId
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  {a.locationCode}
                  <span className="ml-1 text-[10px] text-stone-400 tabular-nums">{a.totalScore.toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Scan / type ----------------------------------------------------- */}
        {/* Camera scan, wedge-gun scan and typing all land in the same `code`
            state; the typedMatch effect above selects the bin either way.
            `onScan` adds nothing to the selection — it exists so the operator
            hears whether the code landed, which is the only thing the gun's own
            beep cannot tell them. */}
        <ScanField
          label="Scan or type a bin code"
          value={code}
          onChange={setCode}
          onScan={(raw) => {
            const hit = locations.find(
              (l) => l.isActive && normalizeScan(l.code) === normalizeScan(raw),
            )
            signalFlash(hit ? 'ok' : 'reject')
          }}
          flash={flash}
          placeholder="e.g. A-01-02-B"
          cameraTitle="Scan a bin label"
          error={typedCode && !typedMatch ? 'No active location with that code in this warehouse.' : undefined}
        />

        {/* Search ---------------------------------------------------------- */}
        <div>
          <label className="block text-xs font-semibold text-stone-600 mb-1.5">Or browse bins</label>
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, name or zone"
              className={fieldCls}
              aria-label="Search bins"
            />
          </div>

          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-stone-100 divide-y divide-stone-100">
            {locationsQuery.isLoading ? (
              <div className="p-4 text-xs text-stone-400">Loading bins…</div>
            ) : matches.length === 0 ? (
              <div className="p-4 text-xs text-stone-400">No bins match that search.</div>
            ) : (
              matches.map((b) => {
                const used = fill.get(b.id) ?? 0
                const cap = b.capacitySlots
                const mismatched = isLevelRoleMismatch(b, allowedLevelRoles)
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => { setChosenId(b.id); setCode('') }}
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 btn-press ${
                      chosenId === b.id ? 'bg-emerald-50' : mismatched ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-stone-50'
                    }`}
                  >
                    {/* Name first, code second (mig 00094) — this list is
                        searched by both, so both stay visible. */}
                    <span className="text-xs text-stone-700 truncate flex-1">{locationTitle(b)}</span>
                    {locationSubtitle(b) && (
                      <span className="font-mono text-[10px] text-stone-400 shrink-0">{locationSubtitle(b)}</span>
                    )}
                    {mismatched && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0"
                        title={`This SKU only allows: ${(allowedLevelRoles ?? []).map((r) => roleLabel(levelRoles, r)).join(', ')}`}
                      >
                        <AlertTriangle className="w-3 h-3" aria-hidden="true" /> {roleLabel(levelRoles, b.levelRole)} level
                      </span>
                    )}
                    <span className="text-[11px] text-stone-400 tabular-nums shrink-0">
                      {cap != null && cap > 0 ? `${Math.round(used)}/${cap}` : `${Math.round(used)}`}
                    </span>
                  </button>
                )
              })
            )}
          </div>
          {storageBins.length > matches.length && !search.trim() && (
            <p className="text-[11px] text-stone-400 mt-1.5">
              Showing {matches.length} of {storageBins.length} bins — search to narrow.
            </p>
          )}
        </div>

        {/* Selection + warnings -------------------------------------------- */}
        {chosen && (
          <div
            className={`rounded-lg border p-3 space-y-2 ${
              roleOverride ? 'border-amber-200 bg-amber-50' : 'border-emerald-100 bg-emerald-50/60'
            }`}
          >
            <p className={`text-sm ${roleOverride ? 'text-amber-800' : 'text-emerald-800'}`}>
              <span className="font-medium">{locationTitle(chosen)}</span>
              {locationSubtitle(chosen) && (
                <span className={`font-mono text-xs ${roleOverride ? 'text-amber-700/70' : 'text-emerald-700/70'}`}>
                  {' '}{locationSubtitle(chosen)}
                </span>
              )}
            </p>
            {warnings.map((w) => (
              <p key={w.code} className="flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{w.message}</span>
              </p>
            ))}
            {roleOverride ? (
              <p className="text-[11px] font-medium text-amber-700">
                This is the engine's hard rule, not just a warning — confirming with "Place anyway" writes an audit
                record of the override.
              </p>
            ) : (
              warnings.length > 0 && (
                <p className="text-[11px] text-stone-500">
                  You can still put it here — this is a warning, not a block.
                </p>
              )
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
