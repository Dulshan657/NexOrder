// The registry: every business metric the app knows, in one place.
//
// Adding a metric here is how a number becomes official. Reading this file is how
// someone finds out what a number on a screen means. Both of those were
// impossible before it existed.

import { INVENTORY_METRICS } from './metrics/inventory'
import { SALES_METRICS } from './metrics/sales'
import type { MetricDef } from './types'

const ALL: readonly MetricDef[] = [...SALES_METRICS, ...INVENTORY_METRICS]

function indexById(defs: readonly MetricDef[]): Readonly<Record<string, MetricDef>> {
  const map: Record<string, MetricDef> = {}
  for (const def of defs) {
    if (map[def.id]) {
      // Two definitions of one id is the exact failure this layer exists to
      // prevent, so it fails at import time rather than picking a winner.
      throw new Error(`[semantic] duplicate metric id: ${def.id}`)
    }
    map[def.id] = def
  }
  return Object.freeze(map)
}

export const METRICS = indexById(ALL)

export function listMetrics(): readonly MetricDef[] {
  return ALL
}

export function getMetric(id: string): MetricDef {
  const def = METRICS[id]
  if (!def) throw new Error(`[semantic] unknown metric: ${id}`)
  return def
}
