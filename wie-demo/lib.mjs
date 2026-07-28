// Shared plumbing for the WIE demo seed/reset: env + service-role client, the
// demo warehouse geometry, and a faithful JS port of the engine's walkway-graph
// builder (supabase/functions/_shared/wie/graph.ts) so the seed can call
// wie_publish_layout_tx directly with a correct node/edge/distance/snap payload.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDevClient } from '../scripts/lib/devClient.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..') // NexOrder/

export const { supa, env: ENV, target: TARGET } = await createDevClient()

// ── Demo constants ───────────────────────────────────────────────────────────
export const WH_CODE = 'WIE-DEMO'
export const WH_NAME = 'WIE Demo DC'
export const CODE_PREFIX = 'WIEDEMO' // every location/product code is namespaced with this
export const GRID = { width: 24, height: 16, cellSize: 1, floorCount: 2 }

// 10 demo products; size_factor varies so occupancy math produces a spread.
// Categories are from the demo catalogue's set (products_category_check).
export const PRODUCTS = [
  { sku: `${CODE_PREFIX}-P01`, name: 'Demo Fast Mover A', category: 'Noodles', sizeFactor: 1 },
  { sku: `${CODE_PREFIX}-P02`, name: 'Demo Fast Mover B', category: 'Noodles', sizeFactor: 0.5 },
  { sku: `${CODE_PREFIX}-P03`, name: 'Demo Fast Mover C', category: 'Noodles', sizeFactor: 2 },
  { sku: `${CODE_PREFIX}-P04`, name: 'Demo Mid Mover D', category: 'Fish', sizeFactor: 1 },
  { sku: `${CODE_PREFIX}-P05`, name: 'Demo Mid Mover E', category: 'Fish', sizeFactor: 2 },
  { sku: `${CODE_PREFIX}-P06`, name: 'Demo Mid Mover F', category: 'Fish', sizeFactor: 1 },
  { sku: `${CODE_PREFIX}-P07`, name: 'Demo Mid Mover G', category: 'Fish', sizeFactor: 3 },
  { sku: `${CODE_PREFIX}-P08`, name: 'Demo Slow Mover H', category: 'Other', sizeFactor: 4 },
  { sku: `${CODE_PREFIX}-P09`, name: 'Demo Slow Mover I', category: 'Other', sizeFactor: 1 },
  { sku: `${CODE_PREFIX}-P10`, name: 'Demo Slow Mover J', category: 'Other', sizeFactor: 0.5 },
]

const BIN_CAPACITY = 10
const XS_LEFT = [3, 5, 7, 9]
const XS_RIGHT = [13, 15, 17, 19]

// Three zones: two on floor 0 (near dock / chilled), one on floor 1 (overflow).
const ZONE_DEFS = [
  { code: `${CODE_PREFIX}-Z1`, name: 'Zone A · Fast movers', zoneType: 'fast_moving', floor: 0, rows: [1, 3] },
  { code: `${CODE_PREFIX}-Z2`, name: 'Zone B · Chilled', zoneType: 'cold', floor: 0, rows: [7, 9] },
  { code: `${CODE_PREFIX}-Z3`, name: 'Zone C · Overflow', zoneType: 'overflow', floor: 1, rows: [1, 3] },
]

/**
 * Build the demo hierarchy + geometry. Returns:
 *  - zones/aisles/racks/bins: location rows to insert (parent linked by code)
 *  - objects: layout_objects (walkways/dock/lift/walls)
 * Bins carry their grid (floor,x,y) for placement + a stable order for stock/picks.
 */
export function buildDemoLayout() {
  const zones = []
  const aisles = []
  const racks = []
  const bins = []

  for (const z of ZONE_DEFS) {
    const zonePath = `${WH_CODE}/${z.code}`
    zones.push({ code: z.code, name: z.name, zoneType: z.zoneType, path: zonePath })
    for (const [aName, xs] of [['AL', XS_LEFT], ['AR', XS_RIGHT]]) {
      const aisleCode = `${z.code}-${aName}`
      const aislePath = `${zonePath}/${aisleCode}`
      aisles.push({ code: aisleCode, name: `Aisle ${aName}`, zoneCode: z.code, path: aislePath })
      z.rows.forEach((row, rIdx) => {
        const rackCode = `${aisleCode}-R${rIdx + 1}`
        const rackPath = `${aislePath}/${rackCode}`
        racks.push({ code: rackCode, name: `Rack ${rIdx + 1}`, aisleCode, path: rackPath })
        for (const x of xs) {
          const binCode = `${rackCode}-B${x}`
          bins.push({
            code: binCode,
            name: `Bin ${binCode}`,
            rackCode,
            zoneType: z.zoneType,
            floor: z.floor,
            x,
            y: row,
            path: `${rackPath}/${binCode}`,
          })
        }
      })
    }
  }

  const objects = []
  const walkway = (floor, x, y, w, h) => objects.push({ objectType: 'walkway', floor, x, y, w, h })
  // Floor 0: two horizontal corridors + one vertical spine down to the dock.
  walkway(0, 1, 2, 22, 1)
  walkway(0, 1, 8, 22, 1)
  walkway(0, 11, 2, 1, 13) // y=2..14
  // Floor 1: one horizontal corridor.
  walkway(1, 1, 2, 22, 1)
  // Dock (floor 0) just below the spine.
  objects.push({ objectType: 'dock', floor: 0, x: 11, y: 15, w: 1, h: 1 })
  // Lift co-located on both floors at (11,2) → creates the inter-floor edge.
  objects.push({ objectType: 'lift', floor: 0, x: 11, y: 2, w: 1, h: 1 })
  objects.push({ objectType: 'lift', floor: 1, x: 11, y: 2, w: 1, h: 1 })
  // Cosmetic perimeter walls (top + sides), clear of walkways/dock/lift.
  for (const floor of [0, 1]) {
    objects.push({ objectType: 'wall', floor, x: 0, y: 0, w: 24, h: 1 })
    objects.push({ objectType: 'wall', floor, x: 0, y: 1, w: 1, h: 14 })
    objects.push({ objectType: 'wall', floor, x: 23, y: 1, w: 1, h: 14 })
  }

  return { zones, aisles, racks, bins, objects }
}

// ── Graph port (mirrors _shared/wie/graph.ts) ────────────────────────────────

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const key = (x, y, f) => `${f}:${x}:${y}`

function buildWalkGraph(cells, cellSizeM) {
  const index = new Map()
  cells.forEach((c, i) => index.set(key(c.x, c.y, c.floor), i))
  const nodes = cells.map((c, i) => {
    let degree = 0
    for (const [dx, dy] of ORTHO) if (index.has(key(c.x + dx, c.y + dy, c.floor))) degree++
    const nodeType = c.isDock ? 'dock' : c.isLift ? 'lift' : degree === 2 ? 'walk' : 'junction'
    return { id: i, floor: c.floor, x: c.x, y: c.y, nodeType }
  })
  const liftWeightM = cellSizeM * 3
  const edges = []
  for (const c of cells) {
    const from = index.get(key(c.x, c.y, c.floor))
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const to = index.get(key(c.x + dx, c.y + dy, c.floor))
      if (to !== undefined) edges.push({ fromNode: from, toNode: to, weightM: cellSizeM, bidirectional: true })
    }
    if (c.isLift) {
      const up = index.get(key(c.x, c.y, c.floor + 1))
      if (up !== undefined && cells[up].isLift) edges.push({ fromNode: from, toNode: up, weightM: liftWeightM, bidirectional: true })
    }
  }
  return { nodes, edges }
}

function dijkstra(nodes, edges, source) {
  const adj = new Map(nodes.map((n) => [n.id, []]))
  for (const e of edges) {
    adj.get(e.fromNode).push({ to: e.toNode, weight: e.weightM })
    if (e.bidirectional) adj.get(e.toNode).push({ to: e.fromNode, weight: e.weightM })
  }
  const dist = new Map([[source, 0]])
  const heap = [{ node: source, dist: 0 }]
  while (heap.length) {
    heap.sort((a, b) => a.dist - b.dist)
    const { node, dist: d } = heap.shift()
    if (d > (dist.get(node) ?? Infinity)) continue
    for (const { to, weight } of adj.get(node) ?? []) {
      const nd = d + weight
      if (nd < (dist.get(to) ?? Infinity)) { dist.set(to, nd); heap.push({ node: to, dist: nd }) }
    }
  }
  return dist
}

function snap(footprint, nodes, cellSizeM) {
  let best = null
  const cx = footprint.x + footprint.w / 2
  const cy = footprint.y + footprint.h / 2
  for (const n of nodes) {
    if (n.floor !== footprint.floor) continue
    const dx = n.x - cx, dy = n.y - cy
    const d2 = dx * dx + dy * dy
    if (!best || d2 < best.d2) best = { id: n.id, d2 }
  }
  return best ? { graphNodeId: best.id, accessOffsetM: Math.sqrt(best.d2) * cellSizeM } : { graphNodeId: null, accessOffsetM: 0 }
}

/**
 * Turn objects + placements into the wie_publish_layout_tx payload. `placements`
 * are { locationId, floor, x, y, w, h }. Throws if any bin is unreachable — the
 * same gate publish-layout enforces.
 */
export function buildGraphPayload(objects, placements, cellSizeM) {
  const cellMap = new Map()
  const add = (floor, x, y, isDock, isLift) => {
    const k = key(x, y, floor)
    const ex = cellMap.get(k)
    if (ex) { ex.isDock = ex.isDock || isDock; ex.isLift = ex.isLift || isLift }
    else cellMap.set(k, { x, y, floor, isDock, isLift })
  }
  for (const o of objects) {
    if (o.objectType !== 'walkway' && o.objectType !== 'dock' && o.objectType !== 'lift') continue
    for (let dy = 0; dy < o.h; dy++) for (let dx = 0; dx < o.w; dx++) add(o.floor, o.x + dx, o.y + dy, o.objectType === 'dock', o.objectType === 'lift')
  }
  const remove = (floor, x, y) => cellMap.delete(key(x, y, floor))
  for (const o of objects) if (o.objectType === 'wall') for (let dy = 0; dy < o.h; dy++) for (let dx = 0; dx < o.w; dx++) remove(o.floor, o.x + dx, o.y + dy)
  for (const p of placements) for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) remove(p.floor, p.x + dx, p.y + dy)

  const cells = [...cellMap.values()]
  const { nodes, edges } = buildWalkGraph(cells, cellSizeM)
  const anchorIds = nodes.filter((n) => n.nodeType === 'dock').map((n) => n.id)
  if (anchorIds.length === 0) throw new Error('demo layout has no dock node')

  const distanceRows = []
  const reachable = new Set()
  for (const a of anchorIds) {
    for (const [to, distanceM] of dijkstra(nodes, edges, a)) {
      distanceRows.push({ from_local: a, to_local: to, distance_m: distanceM })
      reachable.add(to)
    }
  }

  const snaps = []
  const unreachable = []
  for (const p of placements) {
    const s = snap(p, nodes, cellSizeM)
    if (s.graphNodeId === null || !reachable.has(s.graphNodeId)) { unreachable.push(p.locationId); continue }
    snaps.push({ location_id: p.locationId, node_local_id: s.graphNodeId, access_offset_m: s.accessOffsetM })
  }
  if (unreachable.length) throw new Error(`demo layout has ${unreachable.length} unreachable bin(s): ${unreachable.join(', ')}`)

  return {
    p_nodes: nodes.map((n) => ({ local_id: n.id, floor: n.floor, x: n.x, y: n.y, node_type: n.nodeType })),
    p_edges: edges.map((e) => ({ from_local: e.fromNode, to_local: e.toNode, weight_m: e.weightM, bidirectional: e.bidirectional })),
    p_snaps: snaps,
    p_distances: distanceRows,
    p_activate: placements.map((p) => p.locationId),
    p_deactivate: [],
  }
}
