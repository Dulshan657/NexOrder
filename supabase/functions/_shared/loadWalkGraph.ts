// Rebuild a warehouse's walkway graph in memory, ready for route sequencing.
//
// Both route functions need the identical preamble — resolve the warehouse,
// bail out for non-racked sites, load the published layout's nodes and edges,
// find the dock — before they diverge on where their stops come from
// (allocated bins for picking, assigned putaway tasks for the walk). This is
// that preamble, extracted so the two can never drift apart on what counts as
// "legacy" or which node the walk starts from.
//
// Lives in _shared/, NOT _shared/wie/. That directory is pure and IO-free by
// contract because the Vite frontend imports the same modules the server runs
// (see CLAUDE.md); a Deno + Supabase-client helper in there would break the
// browser build.

// deno-lint-ignore-file no-explicit-any
import { EdgeFunctionError } from './errors.ts'
import type { GraphEdge, GraphNode, WarehouseGraph } from './wie/types.ts'

export type WalkGraphResult =
  /** Not a racked site, no published layout, or no dock — caller returns mode:'legacy'. */
  | { mode: 'legacy'; note?: string }
  | { mode: 'engine'; graph: WarehouseGraph; dockNodeId: number; layoutId: number }

/**
 * Load the walk graph for `warehouseId`.
 *
 * `admin` must be a service-role client. Returns `legacy` rather than throwing
 * for every "this site simply isn't routable" case, because that is a normal
 * state (bulk warehouses, layouts still in draft) and not an error the operator
 * should ever see as one.
 */
export async function loadWalkGraph(admin: any, warehouseId: number): Promise<WalkGraphResult> {
  const { data: wh, error: whErr } = await admin.from('locations')
    .select('id, kind, location_type, active_layout_id').eq('id', warehouseId).single()
  if (whErr || !wh || (wh as any).kind !== 'WAREHOUSE') {
    throw new EdgeFunctionError('INVALID_INPUT', 'warehouse_id must reference a WAREHOUSE location')
  }

  const layoutId = (wh as any).active_layout_id as number | null
  if ((wh as any).location_type !== 'racked' || !layoutId) return { mode: 'legacy' }

  const { data: nodeRows, error: nErr } = await admin.from('layout_graph_nodes')
    .select('id, floor, x, y, node_type').eq('layout_id', layoutId).order('id')
  if (nErr) throw new EdgeFunctionError('INTERNAL', `graph nodes load failed: ${nErr.message}`)
  const { data: edgeRows, error: eErr } = await admin.from('layout_graph_edges')
    .select('from_node, to_node, weight_m, bidirectional').eq('layout_id', layoutId)
  if (eErr) throw new EdgeFunctionError('INTERNAL', `graph edges load failed: ${eErr.message}`)

  const nodes: GraphNode[] = ((nodeRows ?? []) as any[]).map((n) => ({
    id: n.id, floor: n.floor, x: n.x, y: n.y, nodeType: n.node_type,
  }))
  const edges: GraphEdge[] = ((edgeRows ?? []) as any[]).map((e) => ({
    fromNode: e.from_node, toNode: e.to_node, weightM: Number(e.weight_m), bidirectional: e.bidirectional,
  }))

  const dock = nodes.find((n) => n.nodeType === 'dock')
  if (!dock) return { mode: 'legacy', note: 'no dock in layout' }

  return { mode: 'engine', graph: { nodes, edges }, dockNodeId: dock.id, layoutId }
}
