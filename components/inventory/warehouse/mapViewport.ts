// Pure viewport math for the Warehouse map's pan/zoom SVG stage. No React, no
// DOM, no I/O — everything here is a plain function over plain numbers, so it's
// fully unit-tested in isolation. This backs a `<g transform="translate(tx,ty)
// scale(scale)">` wrapping a scene drawn in fixed base-cell units (see
// WarehouseCanvas.tsx / MapStage.tsx). Degenerate inputs (zero/negative sizes,
// zero-area bounds, scale of 0) are handled explicitly — see comments below —
// so callers never have to guard against NaN/Infinity themselves.

import type { LayoutPlacement, LayoutObject } from '@/types'

/** The default zoom-out limit, for a floor that fits the screen at or above it. */
export const MIN_SCALE = 0.4
export const MAX_SCALE = 3
/** The absolute floor under every limit: a fitted view never goes below this,
 *  however large the warehouse or small the screen (NX-0047). */
export const FLOOR_MIN_SCALE = 0.05
/** How far past the fitted view a large floor may be zoomed out. */
const FIT_ZOOM_OUT_ROOM = 0.6

/** The zoom range in force. Defaults to [MIN_SCALE, MAX_SCALE]; a floor that only
 *  fits below MIN_SCALE gets a lower minimum from `scaleLimitsForFit`. */
export interface ScaleLimits {
  min: number
  max: number
}

export const DEFAULT_SCALE_LIMITS: ScaleLimits = { min: MIN_SCALE, max: MAX_SCALE }

export interface Viewport {
  scale: number
  tx: number
  ty: number
}

export interface Size {
  width: number
  height: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Clamp a scale factor into the limits (default [MIN_SCALE, MAX_SCALE]).
 *  NaN/Infinity fall back to the minimum. */
export function clampScale(k: number, limits: ScaleLimits = DEFAULT_SCALE_LIMITS): number {
  if (!Number.isFinite(k)) return limits.min
  return Math.min(limits.max, Math.max(limits.min, k))
}

/**
 * The zoom range for a floor whose fitted view is at `fitScale`. A floor that
 * fits at or above MIN_SCALE keeps the default range. A larger one (or a smaller
 * screen) may zoom out a little past its own fit, so the whole warehouse is never
 * out of reach, which it was on a handheld under the fixed 0.4 minimum.
 */
export function scaleLimitsForFit(fitScale: number): ScaleLimits {
  if (!Number.isFinite(fitScale) || fitScale <= 0) return DEFAULT_SCALE_LIMITS
  const min = Math.max(FLOOR_MIN_SCALE, Math.min(MIN_SCALE, fitScale * FIT_ZOOM_OUT_ROOM))
  return { min, max: MAX_SCALE }
}

/** Bring a viewport back inside `limits`, anchored at (cx,cy). Returned unchanged
 *  (the same object) when it is already inside. */
export function clampViewport(vp: Viewport, limits: ScaleLimits, cx: number, cy: number): Viewport {
  const k = clampScale(vp.scale, limits)
  if (k === vp.scale) return vp
  const ratio = k / vp.scale
  return { scale: k, tx: cx - (cx - vp.tx) * ratio, ty: cy - (cy - vp.ty) * ratio }
}

/** Fast at first, settling gently: what a camera move should feel like. */
export function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return 1 - (1 - c) ** 3
}

/**
 * The viewport `t` (0..1, linear time) of the way from `from` to `to`, eased out.
 *
 * Scale moves in LOG space: equal time is an equal zoom ratio, so a 1→4 zoom
 * does not rush its first doubling. With an `anchor`, the world point under it
 * stays fixed on every frame (a zoom about a point): the translation is derived
 * from the scale rather than interpolated, which would bow the path. Without one
 * the translation moves in step with the eased time (a Fit or a floor change,
 * which have no fixed point).
 */
export function interpolateViewport(
  from: Viewport,
  to: Viewport,
  t: number,
  anchor?: { x: number; y: number },
): Viewport {
  if (t <= 0) return from
  if (t >= 1) return to
  const e = easeOutCubic(t)
  const scale = from.scale * (to.scale / from.scale) ** e
  if (anchor) {
    const ratio = scale / from.scale
    return {
      scale,
      tx: anchor.x - (anchor.x - from.tx) * ratio,
      ty: anchor.y - (anchor.y - from.ty) * ratio,
    }
  }
  return {
    scale,
    tx: from.tx + (to.tx - from.tx) * e,
    ty: from.ty + (to.ty - from.ty) * e,
  }
}

/**
 * Zoom to `nextScale` keeping the point (cx,cy) — in stage-local pixels —
 * visually fixed. World coord under the cursor = (cx - tx) / scale; solving
 * for the new translation that keeps that world coord under the same screen
 * point at the new scale gives tx' = cx - (cx - tx) * (k'/k).
 *
 * If the requested scale clamps to the viewport's current scale (already at
 * a limit), the viewport is returned unchanged — no drift while scrolling
 * past the limit.
 */
export function zoomAtPoint(
  vp: Viewport,
  nextScale: number,
  cx: number,
  cy: number,
  limits: ScaleLimits = DEFAULT_SCALE_LIMITS,
): Viewport {
  const k = clampScale(vp.scale, limits)
  const k2 = clampScale(nextScale, limits)
  if (k2 === k) return vp
  const ratio = k2 / k
  return {
    scale: k2,
    tx: cx - (cx - vp.tx) * ratio,
    ty: cy - (cy - vp.ty) * ratio,
  }
}

/** Multiply current scale by `factor`, clamped, anchored at (cx,cy). */
export function zoomByFactor(
  vp: Viewport,
  factor: number,
  cx: number,
  cy: number,
  limits: ScaleLimits = DEFAULT_SCALE_LIMITS,
): Viewport {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1
  return zoomAtPoint(vp, vp.scale * safeFactor, cx, cy, limits)
}

/** Pan the viewport by (dx,dy) pixels. Scale is untouched. */
export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return {
    scale: vp.scale,
    tx: vp.tx + dx,
    ty: vp.ty + dy,
  }
}

/** One frame of a two-finger gesture, in container-local pixels. */
export interface PinchStep {
  /** Where the pinch has stretched to, as an absolute scale — derived from the
   *  distance ratio against the scale the gesture STARTED at, never accumulated
   *  frame to frame, so a pinch out and back returns to exactly where it began. */
  targetScale: number
  /** The two fingers' midpoint now. */
  midX: number
  midY: number
  /** How far that midpoint itself moved since the last frame. */
  dMidX: number
  dMidY: number
}

/**
 * Zoom to `targetScale` anchored at the fingers' midpoint, then follow the midpoint
 * — so a pinch that also slides pans while it zooms, which is what a hand actually
 * does.
 *
 * ORDER MATTERS. `zoomAtPoint` returns the viewport UNCHANGED once the scale has
 * clamped, so panning after it is what keeps a two-finger drag alive at MIN_SCALE
 * and MAX_SCALE. Doing it the other way round would work too, but this way the pan
 * is never scaled by a zoom that did not happen.
 */
export function applyPinch(vp: Viewport, step: PinchStep, limits: ScaleLimits = DEFAULT_SCALE_LIMITS): Viewport {
  const zoomed = zoomAtPoint(vp, step.targetScale, step.midX, step.midY, limits)
  return panBy(zoomed, step.dMidX, step.dMidY)
}

/**
 * Content bounds in PIXEL units (already multiplied by `cell`) for one floor,
 * across both storage placements and layout objects (walls/docks/etc). Returns
 * null when nothing is on that floor so callers can fall back to a default
 * viewport instead of framing an empty/degenerate box.
 */
export function contentBounds(
  placements: LayoutPlacement[],
  objects: LayoutObject[],
  floor: number,
  cell: number,
): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const consider = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }

  for (const p of placements) {
    if (p.floor === floor) consider(p.x, p.y, p.w, p.h)
  }
  for (const o of objects) {
    if (o.floor === floor) consider(o.x, o.y, o.w, o.h)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  return {
    minX: minX * cell,
    minY: minY * cell,
    maxX: maxX * cell,
    maxY: maxY * cell,
  }
}

/**
 * Scale+translate that frames `bounds` inside `container` with `padding` px
 * on all sides, centering the content. Degenerate inputs are handled so this
 * never divides by zero or returns NaN:
 * - Zero/negative container width or height → identity viewport (scale 1, no offset).
 * - Zero-area bounds (a single point, or minX===maxX) → scale clamps to
 *   MAX_SCALE (nothing to fit against) and the point is centered.
 * - The computed scale is clamped to [FLOOR_MIN_SCALE, MAX_SCALE], NOT to
 *   MIN_SCALE: a floor that only fits below 0.4 must still be shown whole
 *   (NX-0047). The caller widens its zoom range to match (scaleLimitsForFit).
 */
export function fitToBounds(bounds: Bounds, container: Size, padding = 24): Viewport {
  const { width, height } = container
  if (!(width > 0) || !(height > 0)) {
    return { scale: 1, tx: 0, ty: 0 }
  }

  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0
  const availW = Math.max(1, width - safePadding * 2)
  const availH = Math.max(1, height - safePadding * 2)

  const boundsW = bounds.maxX - bounds.minX
  const boundsH = bounds.maxY - bounds.minY

  let scale: number
  if (boundsW <= 0 || boundsH <= 0) {
    // Nothing with real extent to fit — don't zoom to infinity, just cap out.
    scale = MAX_SCALE
  } else {
    scale = Math.min(availW / boundsW, availH / boundsH)
  }
  scale = clampScale(scale, { min: FLOOR_MIN_SCALE, max: MAX_SCALE })

  const contentCx = (bounds.minX + bounds.maxX) / 2
  const contentCy = (bounds.minY + bounds.maxY) / 2

  return {
    scale,
    tx: width / 2 - contentCx * scale,
    ty: height / 2 - contentCy * scale,
  }
}
