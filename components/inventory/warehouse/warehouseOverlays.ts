// Pure overlay helpers for the Warehouse grid: map a bin's data to a fill color,
// plus legend definitions. No React, no I/O — unit-tested in isolation so the
// color logic stays honest.
//
// This file is the single source of truth for occupancy color: the bucket
// table below drives both the map fill (occupancyFill) and the tree pill
// (occupancyPill), so the two views can never disagree. The "cannot resolve this
// bin at all" fill also lives here as DEFAULT_BIN_FILL/STROKE, distinct from
// every overlay bucket colour (see the guard test, which checks ALL of them).

import type { VelocityClass } from '@/types'
import { OCCUPANCY_RAMP } from './mapTokens'

export type OverlayKind =
  | 'none' | 'occupancy' | 'velocity' | 'congestion' | 'slotting' | 'unswept'
  // NOT 'slotting' — that key is already taken, by the RESLOT ARROW overlay
  // above, which is a different feature that happens to share the word. Reusing
  // it would make the two silently fight over one switch.
  | 'slotting_blocks'

export interface LegendEntry {
  color: string
  label: string
}

const NEUTRAL = '#e7e5e4' // stone-200

/**
 * Fill/stroke for a bin the map cannot resolve at all — no location row, so no
 * code, no capacity and no storage form. NOT the ordinary resting appearance: a
 * saved bin falls back to the designer's own colour (PLACEMENT_FILL.existing) so
 * the two canvases agree, and only a genuinely unknown cell lands here.
 *
 * stone-300 rather than stone-200 because the header's claim that this is
 * "distinct from every overlay bucket color" was false: it was byte-identical to
 * OCCUPANCY_BUCKETS.none ("No capacity"), so an unresolvable bin and a bin with
 * no capacity configured were indistinguishable, and the guard test only ever
 * compared against the `low` bucket. Both are fixed together.
 */
export const DEFAULT_BIN_FILL = '#d6d3d1' // stone-300
export const DEFAULT_BIN_STROKE = '#a8a29e' // stone-400

// ── Occupancy ────────────────────────────────────────────────────────────────
// fill = used slots / capacity. null = bin has no capacity configured.

export type OccupancyBucket = 'none' | 'empty' | 'low' | 'mid' | 'high' | 'full'

interface OccupancyBucketInfo {
  fill: string
  pill: string
  label: string
}

// ── The ramp (NX-0047) ───────────────────────────────────────────────────────
// The map fill is CONTINUOUS: a 55% bin and a 78% bin are different colours, where
// the old five buckets drew them identically. The stops (and why they stop at a
// mid coral instead of a saturated red) are in mapTokens.ts.

type Triple = [number, number, number]

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  const v = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, v)) * 255)
}

/** sRGB hex → OKLab. Interpolating there, rather than in sRGB, is what keeps the
 *  midpoints from sagging toward grey and the steps perceptually even. */
function hexToOklab(hex: string): Triple {
  const [r, g, b] = [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16)))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToHex([L, a, b]: Triple): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return `#${rgb.map((c) => linearToSrgb(c).toString(16).padStart(2, '0')).join('')}`
}

const RAMP_LAB = OCCUPANCY_RAMP.map(([at, hex]) => ({ at, hex, lab: hexToOklab(hex) }))

/**
 * The occupancy ramp at `pct` (0 = empty, 1 = full). Clamped: over-capacity
 * reads as full, because a stop darker than the last one could not carry the
 * label ink — "over" is said by the number on the bin, not by a redder red.
 */
export function occupancyColor(pct: number): string {
  const p = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0))
  const upper = RAMP_LAB.findIndex((stop) => stop.at >= p)
  if (upper <= 0) return RAMP_LAB[0].hex
  const from = RAMP_LAB[upper - 1]
  const to = RAMP_LAB[upper]
  if (to.at === p) return to.hex
  const t = (p - from.at) / (to.at - from.at)
  return oklabToHex(from.lab.map((v, i) => v + (to.lab[i] - v) * t) as Triple)
}

/** CSS gradient of the ramp, for the legend's bar. */
export const OCCUPANCY_GRADIENT_CSS =
  `linear-gradient(to right, ${OCCUPANCY_RAMP.map(([at, hex]) => `${hex} ${at * 100}%`).join(', ')})`

const EMPTY_FILL = '#ffffff'

// Bucket → {representative fill, tree pill classes, legend label}. The pill and
// the bucket boundaries are unchanged; `fill` is the ramp sampled inside the
// band, so the swatch legend (still used beside the 3D view) and the map cannot
// drift apart.
const OCCUPANCY_BUCKETS: Record<OccupancyBucket, OccupancyBucketInfo> = {
  none: { fill: NEUTRAL, pill: 'bg-stone-100 text-stone-500', label: 'No capacity' },
  empty: { fill: EMPTY_FILL, pill: 'bg-stone-100 text-stone-600', label: 'Empty' },
  low: { fill: occupancyColor(0.25), pill: 'bg-emerald-100 text-emerald-700', label: '<50%' },
  mid: { fill: occupancyColor(0.65), pill: 'bg-amber-100 text-amber-700', label: '50–80%' },
  high: { fill: occupancyColor(0.9), pill: 'bg-orange-100 text-orange-700', label: '80–100%' },
  full: { fill: occupancyColor(1), pill: 'bg-red-100 text-red-700', label: 'Full / over' },
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

/** The map fill: neutral with no capacity configured, white when empty (nothing
 *  here is a different fact from "a little here"), the ramp otherwise. */
export function occupancyFill(pct: number | null | undefined): string {
  if (pct == null) return NEUTRAL
  if (pct <= 0) return EMPTY_FILL
  return occupancyColor(pct)
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

/**
 * Which bins still carry a code no operator chose (migs 00107 / 00108).
 *
 * `code_block IS NULL` is the provenance signal 00107 added and it means exactly
 * "this code was not minted by a pattern" — true of every bin drawn before the
 * sweep tool existed. So this is a FACT about the row, not a heuristic about the
 * string, which is why it can be trusted to tell an operator which parts of a site
 * they have not got to yet.
 */
export function unsweptFill(codeBlock: string | null | undefined): string {
  return codeBlock ? SWEPT_FILL : UNSWEPT_FILL
}

/** Amber for outstanding, the same reading as the label backlog's. */
/** Blocks are tinted per BLOCK from a fixed rotation rather than by any
 *  property of the bin: the question this overlay answers is "which block is
 *  this", and adjacent blocks needing different colours is the only constraint.
 *  Stone-adjacent and desaturated so it reads under the existing rack colours
 *  rather than fighting them. */
const BLOCK_FILLS = ['#bfdbfe', '#bbf7d0', '#fde68a', '#fbcfe8', '#ddd6fe', '#c7d2fe', '#fed7aa', '#a5f3fc']
export const OFF_HOME_FILL = '#fecaca'

export function blockFill(blockId: number): string {
  return BLOCK_FILLS[blockId % BLOCK_FILLS.length]
}

export const SLOTTING_BLOCKS_LEGEND: LegendEntry[] = [
  { color: BLOCK_FILLS[0], label: 'In a block' },
  { color: OFF_HOME_FILL, label: 'Holds off-home stock' },
  { color: NEUTRAL, label: 'Unassigned' },
]

const UNSWEPT_FILL = '#fcd34d'
const SWEPT_FILL = '#d1fae5'

export const UNSWEPT_LEGEND: LegendEntry[] = [
  { color: UNSWEPT_FILL, label: 'Still to recode' },
  { color: SWEPT_FILL, label: 'Recoded' },
]

export function legendFor(overlay: OverlayKind): LegendEntry[] {
  switch (overlay) {
    case 'occupancy': return OCCUPANCY_LEGEND
    case 'velocity': return VELOCITY_LEGEND
    case 'congestion': return CONGESTION_LEGEND
    case 'slotting': return SLOTTING_LEGEND
    case 'slotting_blocks': return SLOTTING_BLOCKS_LEGEND
    case 'unswept': return UNSWEPT_LEGEND
    default: return []
  }
}
