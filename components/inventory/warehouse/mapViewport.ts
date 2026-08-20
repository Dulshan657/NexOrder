// Pure viewport math for the Warehouse map's pan/zoom SVG stage. No React, no
// DOM, no I/O — everything here is a plain function over plain numbers, so it's
// fully unit-tested in isolation. This backs a `<g transform="translate(tx,ty)
// scale(scale)">` wrapping a scene drawn in fixed base-cell units (see
// WarehouseCanvas.tsx / MapStage.tsx). Degenerate inputs (zero/negative sizes,
// zero-area bounds, scale of 0) are handled explicitly — see comments below —
// so callers never have to guard against NaN/Infinity themselves.

import type { LayoutPlacement, LayoutObject } from '@/types'

export const MIN_SCALE = 0.4
export const MAX_SCALE = 3

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

/** Clamp a scale factor into [MIN_SCALE, MAX_SCALE]. NaN/Infinity fall back to MIN_SCALE. */
export function clampScale(k: number): number {
  if (!Number.isFinite(k)) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, k))
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
export function zoomAtPoint(vp: Viewport, nextScale: number, cx: number, cy: number): Viewport {
  const k = clampScale(vp.scale)
  const k2 = clampScale(nextScale)
  if (k2 === k) return vp
  const ratio = k2 / k
  return {
    scale: k2,
    tx: cx - (cx - vp.tx) * ratio,
    ty: cy - (cy - vp.ty) * ratio,
  }
}

/** Multiply current scale by `factor`, clamped, anchored at (cx,cy). */
export function zoomByFactor(vp: Viewport, factor: number, cx: number, cy: number): Viewport {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1
  return zoomAtPoint(vp, vp.scale * safeFactor, cx, cy)
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
export function applyPinch(vp: Viewport, step: PinchStep): Viewport {
  const zoomed = zoomAtPoint(vp, step.targetScale, step.midX, step.midY)
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
 * - The computed scale is always clamped to [MIN_SCALE, MAX_SCALE].
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
  scale = clampScale(scale)

  const contentCx = (bounds.minX + bounds.maxX) / 2
  const contentCy = (bounds.minY + bounds.maxY) / 2

  return {
    scale,
    tx: width / 2 - contentCx * scale,
    ty: height / 2 - contentCy * scale,
  }
}
