// Pure overlay helpers for the Warehouse grid: map a bin's data to a fill color,
// plus legend definitions. No React, no I/O — unit-tested in isolation so the
// color logic stays honest.

import type { VelocityClass } from '@/types'

export type OverlayKind = 'none' | 'occupancy' | 'velocity' | 'congestion' | 'slotting'

export interface LegendEntry {
  color: string
  label: string
}

const NEUTRAL = '#e7e5e4' // stone-200

// ── Occupancy ────────────────────────────────────────────────────────────────
// fill = used slots / capacity. null = bin has no capacity configured.

export function occupancyFill(pct: number | null | undefined): string {
  if (pct == null) return NEUTRAL
  if (pct <= 0) return '#ffffff'
  if (pct < 0.5) return '#6ee7b7' // emerald-300
  if (pct < 0.8) return '#fcd34d' // amber-300
  if (pct < 1) return '#fb923c' // orange-400
  return '#ef4444' // red-500 (at/over capacity)
}

export const OCCUPANCY_LEGEND: LegendEntry[] = [
  { color: '#ffffff', label: 'Empty' },
  { color: '#6ee7b7', label: '<50%' },
  { color: '#fcd34d', label: '50–80%' },
  { color: '#fb923c', label: '80–100%' },
  { color: '#ef4444', label: 'Full / over' },
  { color: NEUTRAL, label: 'No capacity' },
]

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
