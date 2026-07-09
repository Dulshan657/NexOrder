// Pure overlay helpers for the Warehouse grid: map a bin's data to a fill color,
// plus legend definitions. No React, no I/O — unit-tested in isolation so the
// color logic stays honest.
//
// This file is the single source of truth for occupancy color: the bucket
// table below drives both the map fill (occupancyFill) and the tree pill
// (occupancyPill), so the two views can never disagree. The neutral "no data"
// fill also lives here as DEFAULT_BIN_FILL/STROKE — the map's default bin
// appearance, deliberately distinct from every overlay bucket color (see the
// `DEFAULT_BIN_FILL !== occupancyFill(...)` guard test).

import type { VelocityClass } from '@/types'

export type OverlayKind = 'none' | 'occupancy' | 'velocity' | 'congestion' | 'slotting'

export interface LegendEntry {
  color: string
  label: string
}

const NEUTRAL = '#e7e5e4' // stone-200

/** Default (no overlay active) bin fill/stroke on the map — neutral stone,
 *  intentionally distinct from every occupancy bucket color below. */
export const DEFAULT_BIN_FILL = '#e7e5e4' // stone-200
export const DEFAULT_BIN_STROKE = '#a8a29e' // stone-400

// ── Occupancy ────────────────────────────────────────────────────────────────
// fill = used slots / capacity. null = bin has no capacity configured.

export type OccupancyBucket = 'none' | 'empty' | 'low' | 'mid' | 'high' | 'full'

interface OccupancyBucketInfo {
  fill: string
  pill: string
  label: string
}

// Single source of truth: bucket → {map fill, tree pill classes, legend label}.
// occupancyFill/occupancyPill/OCCUPANCY_LEGEND all derive from this table so
// they can never drift apart.
const OCCUPANCY_BUCKETS: Record<OccupancyBucket, OccupancyBucketInfo> = {
  none: { fill: NEUTRAL, pill: 'bg-stone-100 text-stone-500', label: 'No capacity' },
  empty: { fill: '#ffffff', pill: 'bg-stone-100 text-stone-400', label: 'Empty' },
  low: { fill: '#6ee7b7', pill: 'bg-emerald-100 text-emerald-700', label: '<50%' }, // emerald-300
  mid: { fill: '#fcd34d', pill: 'bg-amber-100 text-amber-700', label: '50–80%' }, // amber-300
  high: { fill: '#fb923c', pill: 'bg-orange-100 text-orange-700', label: '80–100%' }, // orange-400
  full: { fill: '#ef4444', pill: 'bg-red-100 text-red-700', label: 'Full / over' }, // red-500 (at/over capacity)
}

/** Bucket boundaries: none(null) empty(<=0) low(<0.5) mid(<0.8) high(<1) full(>=1). */
export function occupancyBucket(pct?: number | null): OccupancyBucket {
  if (pct == null) return 'none'
  if (pct <= 0) return 'empty'
  if (pct < 0.5) return 'low'
  if (pct < 0.8) return 'mid'
  if (pct < 1) return 'high'
  return 'full'
}

export function occupancyFill(pct: number | null | undefined): string {
  return OCCUPANCY_BUCKETS[occupancyBucket(pct)].fill
}

/** Tailwind bg/text classes for the tree's fill pill — same bucket table as the map fill. */
export function occupancyPill(pct?: number | null): string {
  return OCCUPANCY_BUCKETS[occupancyBucket(pct)].pill
}

// Reading order for the legend: emptiest → fullest, "no capacity" last.
const OCCUPANCY_LEGEND_ORDER: OccupancyBucket[] = ['empty', 'low', 'mid', 'high', 'full', 'none']

export const OCCUPANCY_LEGEND: LegendEntry[] = OCCUPANCY_LEGEND_ORDER.map((bucket) => ({
  color: OCCUPANCY_BUCKETS[bucket].fill,
  label: OCCUPANCY_BUCKETS[bucket].label,
}))

// ── Velocity (ABC) ───────────────────────────────────────────────────────────

const VELOCITY_COLOR: Record<VelocityClass, string> = {
  A: '#f43f5e', // rose-500
  B: '#fbbf24', // amber-400
  C: '#7dd3fc', // sky-300
}

export function velocityFill(cls: VelocityClass | null | undefined): string {
  return cls ? VELOCITY_COLOR[cls] : NEUTRAL
}

export const VELOCITY_LEGEND: LegendEntry[] = [
  { color: VELOCITY_COLOR.A, label: 'A (fast)' },
  { color: VELOCITY_COLOR.B, label: 'B (medium)' },
  { color: VELOCITY_COLOR.C, label: 'C (slow)' },
  { color: NEUTRAL, label: 'No data' },
]

// ── Congestion ───────────────────────────────────────────────────────────────
// Quintile buckets over 30-day pick visits (colorblind-safer than a smooth ramp).
// Returns null for nodes with no traffic so those bins keep the base fill.

const CONGESTION_SCALE = ['#bae6fd', '#7dd3fc', '#fbbf24', '#fb923c', '#ef4444']

export function congestionFill(visits: number, max: number): string | null {
  if (visits <= 0 || max <= 0) return null
  const q = Math.min(5, Math.ceil((visits / max) * 5))
  return CONGESTION_SCALE[q - 1]
}

export const CONGESTION_LEGEND: LegendEntry[] = [
  { color: CONGESTION_SCALE[0], label: 'Low' },
  { color: CONGESTION_SCALE[1], label: '' },
  { color: CONGESTION_SCALE[2], label: 'Mid' },
  { color: CONGESTION_SCALE[3], label: '' },
  { color: CONGESTION_SCALE[4], label: 'High' },
]

export const SLOTTING_LEGEND: LegendEntry[] = [
  { color: '#8b5cf6', label: 'Suggested move (from → to)' },
]

export function legendFor(overlay: OverlayKind): LegendEntry[] {
  switch (overlay) {
    case 'occupancy': return OCCUPANCY_LEGEND
    case 'velocity': return VELOCITY_LEGEND
    case 'congestion': return CONGESTION_LEGEND
    case 'slotting': return SLOTTING_LEGEND
    default: return []
  }
}
