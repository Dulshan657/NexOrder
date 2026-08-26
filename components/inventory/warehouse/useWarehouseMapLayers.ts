// Everything the live map needs to COLOUR and LABEL itself, derived in one place.
//
// All of it is a reshape of queries already in memory (locations, storage types,
// zone profiles, level roles, the viewer model) — no fetching happens here. It was
// lifted wholesale out of RackedWorkspace, which had grown to 875 lines and was
// mixing eight display derivations in among the interaction state that actually
// belongs to a workspace component.
//
// Every value here is memoized for IDENTITY as much as for cost. They are props of
// WarehouseCanvas, whose `scene` useMemo lists them all, and the component
// re-renders on every frame of a pan — so a value rebuilt per render rebuilds 945
// bins per frame. That is not hypothetical: it is the documented freeze that made
// the tab unresponsive enough that Chrome could not be scripted.

import { useMemo } from 'react'
import type { LayoutObject, LayoutPlacement, VelocityClass } from '@/types'
import type { BinInfo } from './WarehouseCanvas'
import type { useWarehouseViewerModel } from './useWarehouseViewerModel'
import { zoneRegions as computeZoneRegions } from './zoneRegions'
import {
  occupancyFill, velocityFill, congestionFill, unsweptFill, blockFill, OFF_HOME_FILL,
  type OverlayKind, type LegendEntry,
} from './warehouseOverlays'
import { zoneTint, zoneTypeLabel } from './zoneTints'
import { OBJECT_FILL } from '@/components/admin/layout/layoutPalette'
import { roleLabel, sortedRoles } from '@/lib/levelRoles'

/** Swatch for an area with no zone profile — the same neutral both canvases
 *  paint it with, so the legend never promises a colour the map doesn't use. */
const AREA_LEGEND_FALLBACK = OBJECT_FILL.area

type ViewerModel = ReturnType<typeof useWarehouseViewerModel>

export interface WarehouseMapLayersArgs {
  model: ViewerModel
  placements: readonly LayoutPlacement[]
  placementByLocation: ReadonlyMap<number, LayoutPlacement>
  objects: readonly LayoutObject[]
  storageTypes: ReadonlyArray<{ id: number; name: string; color?: string | null }>
  zoneProfiles: ReadonlyArray<{ id: number; zoneType: string }>
  levelRoles: ReadonlyArray<{ key: string; colorFill: string }>
  overlay: OverlayKind
  floor: number
  /** locationId -> the slotting blocks it belongs to (mig 00115), and the bins
   *  currently holding off-home stock. Both empty unless the `slotting_blocks`
   *  overlay is on — this is the one overlay whose data is not already loaded
   *  for the map, so the caller fetches it only when asked. */
  slotBlockIdsByLocation?: ReadonlyMap<number, readonly number[]>
  offHomeLocationIds?: ReadonlySet<number>
}

export interface WarehouseMapLayers {
  binColors: Map<number, string> | undefined
  rackColors: Map<number, string> | undefined
  binBadges: Map<number, string> | undefined
  binInfo: Map<number, BinInfo>
  zoneAreas: ReturnType<typeof computeZoneRegions>
  zoneTypeByProfileId: Map<number, string>
  legendExtras: LegendEntry[]
}

export function useWarehouseMapLayers(args: WarehouseMapLayersArgs): WarehouseMapLayers {
  const {
    model, placements, placementByLocation, objects,
    storageTypes, zoneProfiles, levelRoles, overlay, floor,
    slotBlockIdsByLocation, offHomeLocationIds,
  } = args

  // Overlay fill per bin. Slotting draws arrows instead of fills.
  const binColors = useMemo(() => {
    if (overlay === 'none' || overlay === 'slotting') return undefined
    const map = new Map<number, string>()
    for (const p of placements) {
      if (overlay === 'occupancy') {
        map.set(p.locationId, occupancyFill(model.binFillPct.get(p.locationId)))
      } else if (overlay === 'velocity') {
        map.set(p.locationId, velocityFill(model.binVelocityClass.get(p.locationId)))
      } else if (overlay === 'congestion' && p.graphNodeId != null) {
        const c = congestionFill(model.visitsByNode.get(p.graphNodeId) ?? 0, model.maxVisits)
        if (c) map.set(p.locationId, c)
      } else if (overlay === 'slotting_blocks') {
        // Off-home wins over the block tint: a bin can be both (it belongs to
        // one block and holds a product homed in another), and "there is
        // something here that should not be" is the more urgent of the two.
        const blocks = slotBlockIdsByLocation?.get(p.locationId)
        if (offHomeLocationIds?.has(p.locationId)) map.set(p.locationId, OFF_HOME_FILL)
        else if (blocks && blocks.length > 0) map.set(p.locationId, blockFill(blocks[0]))
      } else if (overlay === 'unswept') {
        // Read off the LOCATION, not the placement: `code_block` is provenance on
        // the row, and a levelled rack's levels each carry null by design (see
        // buildRecodeRows) — so a level asks its rack, which is the unit a sweep
        // actually numbers.
        const loc = model.locationsById.get(p.locationId)
        const owner = loc?.kind === 'SHELF' && loc.parentId != null
          ? model.locationsById.get(loc.parentId)
          : loc
        map.set(p.locationId, unsweptFill(owner?.codeBlock))
      }
    }
    return map
  }, [
    overlay, placements, model.binFillPct, model.binVelocityClass,
    model.visitsByNode, model.maxVisits, model.locationsById,
    slotBlockIdsByLocation, offHomeLocationIds,
  ])

  // "×N" badge on multi-product bins while the velocity overlay is active.
  const binBadges = useMemo(() => {
    if (overlay !== 'velocity') return undefined
    const map = new Map<number, string>()
    for (const p of placements) {
      const n = model.binContents.get(p.locationId)?.length ?? 0
      if (n > 1) map.set(p.locationId, `×${n}`)
    }
    return map
  }, [overlay, placements, model.binContents])

  const formColorById = useMemo(() => {
    const map = new Map<number, string>()
    for (const st of storageTypes) if (st.color) map.set(st.id, st.color)
    return map
  }, [storageTypes])

  const zoneTypeByProfileId = useMemo(() => {
    const map = new Map<number, string>()
    for (const zp of zoneProfiles) map.set(zp.id, zp.zoneType)
    return map
  }, [zoneProfiles])

  /** Per-location display record for on-map labels, spines and the hover card.
   *  Covers RACK parents too: a rack owns no stock itself, but it owns the code
   *  the map labels the cell with, and its capacity is the sum of its levels'. */
  const binInfo = useMemo(() => {
    const map = new Map<number, BinInfo>()
    for (const loc of model.locationsById.values()) {
      const contents = model.binContents.get(loc.id) ?? []
      // Dominant SKU by slots occupied — the same rule the tree and the detail
      // panel use to pick a bin's headline product.
      let top: (typeof contents)[number] | null = null
      for (const row of contents) if (!top || row.slots > top.slots) top = row

      let capacitySlots = loc.capacitySlots
      if (loc.kind === 'RACK') {
        const levels = model.levelsByRackId.get(loc.id) ?? []
        const summed = levels.reduce((acc, lv) => acc + (lv.capacitySlots ?? 0), 0)
        capacitySlots = summed > 0 ? summed : undefined
      }

      map.set(loc.id, {
        code: loc.code,
        // Already on the client: getWarehouseLocations does select('*'), so the
        // friendly name (mig 00094) arrives with no new query.
        name: loc.name,
        capacitySlots,
        slotKind: loc.slotKind,
        contentsCount: contents.length,
        topSku: top?.productName ?? undefined,
        formColor: loc.storageTypeId != null ? formColorById.get(loc.storageTypeId) : undefined,
      })
    }
    return map
  }, [model.locationsById, model.binContents, model.levelsByRackId, formColorById])

  /** Overlay colour for a whole rack, for the zoomed-out case where the cell is
   *  too small to draw a per-level spine.
   *
   *  This replaces the canvas's old "colour of whichever level happened to be
   *  first", which could paint a rack white when its pick face was jammed and
   *  its bulk level empty. Occupancy rolls up weighted by capacity; velocity
   *  reports the fastest class present and congestion the busiest node, since
   *  those are the levels an operator needs to notice. */
  const rackColors = useMemo(() => {
    if (overlay === 'none' || overlay === 'slotting') return undefined
    const map = new Map<number, string>()
    for (const [rackId, levels] of model.levelsByRackId) {
      if (overlay === 'occupancy') {
        let used = 0
        let capacity = 0
        for (const lv of levels) {
          const pct = model.binFillPct.get(lv.id)
          const cap = lv.capacitySlots
          if (pct == null || cap == null || cap <= 0) continue
          used += pct * cap
          capacity += cap
        }
        map.set(rackId, occupancyFill(capacity > 0 ? used / capacity : null))
      } else if (overlay === 'velocity') {
        const order: VelocityClass[] = ['A', 'B', 'C']
        let best: VelocityClass | null = null
        for (const lv of levels) {
          const cls = model.binVelocityClass.get(lv.id)
          if (cls && (best == null || order.indexOf(cls) < order.indexOf(best))) best = cls
        }
        map.set(rackId, velocityFill(best))
      } else if (overlay === 'unswept') {
        map.set(rackId, unsweptFill(model.locationsById.get(rackId)?.codeBlock))
      } else if (overlay === 'congestion') {
        let peak = 0
        for (const lv of levels) {
          const node = placementByLocation.get(lv.id)?.graphNodeId
          if (node != null) peak = Math.max(peak, model.visitsByNode.get(node) ?? 0)
        }
        const c = congestionFill(peak, model.maxVisits)
        if (c) map.set(rackId, c)
      }
    }
    return map
  }, [
    overlay, model.levelsByRackId, model.binFillPct, model.binVelocityClass,
    model.visitsByNode, model.maxVisits, placementByLocation, model.locationsById,
  ])

  /** Zones have no geometry of their own (see zoneRegions.ts) — recover the area
   *  each one covers from the cells of the bins parented under it. */
  const zoneAreas = useMemo(
    () => computeZoneRegions(placements as LayoutPlacement[], model.locationsById, floor),
    [placements, model.locationsById, floor],
  )

  /** Legend rows for the map's own colours, restricted to what this warehouse
   *  actually contains. Storage forms are omitted while an overlay is active
   *  because the overlay has recoloured those very bins — showing the form
   *  swatches then would explain a colour that is no longer on screen. */
  const legendExtras = useMemo(() => {
    const entries: LegendEntry[] = []

    if (overlay === 'none') {
      const usedFormIds = new Set<number>()
      for (const loc of model.locationsById.values()) {
        if (loc.storageTypeId != null) usedFormIds.add(loc.storageTypeId)
      }
      for (const st of storageTypes) {
        if (st.color && usedFormIds.has(st.id)) entries.push({ color: st.color, label: st.name })
      }
    }

    const usedRoleKeys = new Set<string>()
    for (const loc of model.locationsById.values()) {
      if (loc.levelRole) usedRoleKeys.add(loc.levelRole)
    }
    for (const role of sortedRoles(levelRoles as any)) {
      if (usedRoleKeys.has(role.key)) {
        entries.push({ color: role.colorFill, label: roleLabel(levelRoles as any, role.key) })
      }
    }

    // Named areas (mig 00090). Listed before the derived zone rows because an
    // area is what the operator actually drew and named; a zone region is
    // inferred from bin ancestry. Deduped by name — an area is many 1×1 cells.
    const seenAreas = new Set<string>()
    for (const o of objects) {
      if (o.objectType !== 'area' || o.floor !== floor) continue
      const name = typeof o.meta?.name === 'string' ? o.meta.name : ''
      if (!name || seenAreas.has(name)) continue
      seenAreas.add(name)
      const zp = o.meta?.zoneProfileId
      const zoneType = typeof zp === 'number' ? zoneTypeByProfileId.get(zp) : undefined
      entries.push({ color: zoneType ? zoneTint(zoneType) : AREA_LEGEND_FALLBACK, label: name })
    }

    const seenZoneTypes = new Set<string>()
    for (const area of zoneAreas) {
      const type = area.zoneProfileId != null ? zoneTypeByProfileId.get(area.zoneProfileId) : undefined
      const key = type ?? ''
      if (seenZoneTypes.has(key)) continue
      seenZoneTypes.add(key)
      entries.push({ color: zoneTint(type), label: `${zoneTypeLabel(type)} zone` })
    }

    return entries
  }, [overlay, model.locationsById, storageTypes, levelRoles, zoneAreas, zoneTypeByProfileId, objects, floor])

  return { binColors, rackColors, binBadges, binInfo, zoneAreas, zoneTypeByProfileId, legendExtras }
}
