// Owns the Warehouse map's pan/zoom interaction state: wheel-to-zoom,
// pointer-drag-to-pan, keyboard nav, and fit-to-content. All the actual math is
// in mapViewport.ts (pure, unit-tested) — this hook is just wiring: refs,
// event listeners, and the click-suppression flag a caller needs to stop a pan
// from also selecting a bin.
//
// Gestures used to be disabled below the `md` breakpoint, leaving phones a static
// fitted view. They are unconditional now: a warehouse operator standing at a rack
// has a phone, not a laptop, and the code sweep they need is on this map. What
// replaced the breakpoint is `coarsePointer` — which is about what the INPUT is
// (cursor affordances, hint wording), never about what the map is allowed to do.
//
// Two fingers pinch and pan. That is real multi-touch rather than a wheel event in
// disguise: `pointersRef` tracks every pointer down on the stage — including ones a
// paint or brush stroke owns — because otherwise a pinch starting under a live
// stroke has only one finger to measure. MapStage calls `track` unconditionally in
// all four pointer handlers for exactly that reason, and a source test pins it.

import { useCallback, useEffect, useRef, useState, type RefObject, type PointerEvent, type KeyboardEvent } from 'react'
import type { LayoutPlacement, LayoutObject } from '@/types'
import { BASE_CELL } from '@/components/admin/layout/layoutPalette'
import {
  type Viewport,
  applyPinch,
  contentBounds,
  fitToBounds,
  panBy,
  zoomByFactor,
} from './mapViewport'

/** Affordances only — never a capability gate. See the header. */
const COARSE_POINTER_QUERY = '(pointer: coarse)'
const DRAG_THRESHOLD_PX = 4
const PAN_STEP_PX = 48
const WHEEL_ZOOM_FACTOR = 1.1
const BUTTON_ZOOM_FACTOR = 1.2
const FIT_PADDING = 32

interface PanState {
  pointerId: number
  lastX: number
  lastY: number
  startX: number
  startY: number
  /** Whether setPointerCapture was actually taken for this pointer session —
   *  only true once the drag threshold is crossed (see onPointerMove). */
  captured: boolean
}

interface PinchState {
  a: number
  b: number
  /** Captured once at the start, so the gesture is reversible to the exact scale it
   *  began at rather than accumulating float drift over a hundred frames. */
  startDist: number
  startScale: number
  lastMidX: number
  lastMidY: number
}

interface TrackedPointer {
  x: number
  y: number
  type: string
}

export interface UseMapViewportArgs {
  placements: LayoutPlacement[]
  objects: LayoutObject[]
  floor: number
}

export interface MapViewportHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void
  onPointerMove: (e: PointerEvent<HTMLElement>) => void
  onPointerUp: (e: PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

export interface UseMapViewportResult {
  viewport: Viewport
  containerRef: RefObject<HTMLDivElement | null>
  handlers: MapViewportHandlers
  fit: () => void
  zoomIn: () => void
  zoomOut: () => void
  isPanning: boolean
  /** True if the pointer session in progress (or just ended) moved past the
   *  drag threshold — callers use this to suppress a bin click after a pan. */
  didDrag: () => boolean
  /** True for touch and pen. Decides cursor affordances and hint wording ONLY —
   *  every gesture is available regardless. */
  coarsePointer: boolean
  /**
   * Record a pointer and return how many are now down.
   *
   * MUST be called at the top of all four pointer handlers, unconditionally,
   * INCLUDING the ones where a paint or brush stroke returns before reaching
   * `handlers`. A pinch that starts under a live stroke otherwise has only one
   * finger to measure against. Pinned by __tests__/mapPointerContract.test.ts.
   */
  track: (e: PointerEvent<HTMLElement>) => number
  /** Begin a two-finger gesture, abandoning any pan in flight. */
  startPinch: (e: PointerEvent<HTMLElement>) => void
}

function matchesCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COARSE_POINTER_QUERY).matches
}

export function useMapViewport({ placements, objects, floor }: UseMapViewportArgs): UseMapViewportResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, tx: 0, ty: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [coarsePointer, setCoarsePointer] = useState<boolean>(matchesCoarsePointer)

  const panStateRef = useRef<PanState | null>(null)
  const movedRef = useRef(false)
  const hasSizedRef = useRef(false)
  const pointersRef = useRef(new Map<number, TrackedPointer>())
  const pinchRef = useRef<PinchState | null>(null)
  /** The latest viewport, for handlers that must read rather than update it. One
   *  frame of staleness cannot matter: a pinch begins on a pointer event. */
  const viewportRef = useRef(viewport)
  useEffect(() => { viewportRef.current = viewport }, [viewport])

  // ── Media query: input affordances, NOT a capability gate ───────────────
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(COARSE_POINTER_QUERY)
    const onChange = () => setCoarsePointer(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // ── Fit-to-content ───────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (!(rect.width > 0) || !(rect.height > 0)) return
    const bounds = contentBounds(placements, objects, floor, BASE_CELL)
    if (!bounds) {
      setViewport({ scale: 1, tx: 0, ty: 0 })
      return
    }
    setViewport(fitToBounds(bounds, { width: rect.width, height: rect.height }, FIT_PADDING))
  }, [placements, objects, floor])

  // Fit on mount and whenever the floor (or the content backing it) changes.
  useEffect(() => {
    fit()
  }, [fit])

  // Fit once when the container first gets a real size — on first paint the
  // flex/grid layout may not have settled yet, so `fit()` above can no-op.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0 && !hasSizedRef.current) {
        hasSizedRef.current = true
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  // ── Wheel = zoom (non-passive; React's onWheel can't preventDefault) ────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Require Ctrl/⌘ so plain scroll always passes through to the page (the
      // map no longer traps the wheel just because the cursor is over it).
      // Trackpad pinch-to-zoom also reports ctrlKey:true, which we want to
      // intercept, so this doubles as the pinch gesture.
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR
      setViewport((vp) => zoomByFactor(vp, factor, cx, cy))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Drag to pan (Pointer Events) ─────────────────────────────────────────
  // Capture is taken lazily (see onPointerMove) rather than here: capturing on
  // every pointerdown routes the trailing `click` to the container instead of
  // the element under the cursor (Pointer Events spec), so a bin's onClick
  // never fired. A clean click now never captures at all.
  /** See the contract on UseMapViewportResult.track. */
  const track = useCallback((e: PointerEvent<HTMLElement>): number => {
    const m = pointersRef.current
    if (e.type === 'pointerdown') {
      m.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    } else if (e.type === 'pointermove') {
      const p = m.get(e.pointerId)
      if (p) { p.x = e.clientX; p.y = e.clientY }
    } else {
      m.delete(e.pointerId)
    }
    return m.size
  }, [])

  const startPinch = useCallback((e: PointerEvent<HTMLElement>) => {
    const touches = [...pointersRef.current.entries()].filter(([, p]) => p.type !== 'mouse')
    if (touches.length < 2) return
    const el = containerRef.current
    if (!el) return
    // The two most recent, so a third finger resting on the screen does not
    // silently anchor the gesture somewhere the operator is not pinching.
    const [[aId, a], [bId, b]] = touches.slice(-2)
    const rect = el.getBoundingClientRect()
    // Two fingers are never a pan, so a one-finger pan in flight loses outright.
    panStateRef.current = null
    // And whatever a two-finger gesture does next, it must never end in a bin click.
    movedRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    pinchRef.current = {
      a: aId,
      b: bId,
      // Two fingers at one point would otherwise divide by zero — the same
      // defensive posture mapViewport takes for zero-area bounds.
      startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startScale: viewportRef.current.scale,
      lastMidX: (a.x + b.x) / 2 - rect.left,
      lastMidY: (a.y + b.y) / 2 - rect.top,
    }
    setIsPanning(true)
  }, [])

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    panStateRef.current = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      captured: false,
    }
    movedRef.current = false
    setIsPanning(true)
  }, [])

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const pinch = pinchRef.current
    if (pinch) {
      if (e.pointerId !== pinch.a && e.pointerId !== pinch.b) return
      // Both fingers are read from pointersRef, which `track` has already updated
      // for this event — that is what the tracking contract buys.
      const a = pointersRef.current.get(pinch.a)
      const b = pointersRef.current.get(pinch.b)
      const el = containerRef.current
      if (!a || !b || !el) return
      const rect = el.getBoundingClientRect()
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      const midX = (a.x + b.x) / 2 - rect.left
      const midY = (a.y + b.y) / 2 - rect.top
      setViewport((vp) => applyPinch(vp, {
        targetScale: pinch.startScale * (dist / pinch.startDist),
        midX,
        midY,
        dMidX: midX - pinch.lastMidX,
        dMidY: midY - pinch.lastMidY,
      }))
      pinch.lastMidX = midX
      pinch.lastMidY = midY
      return
    }
    const pan = panStateRef.current
    if (!pan || pan.pointerId !== e.pointerId) return
    const dx = e.clientX - pan.lastX
    const dy = e.clientY - pan.lastY
    pan.lastX = e.clientX
    pan.lastY = e.clientY
    if (!pan.captured && Math.hypot(e.clientX - pan.startX, e.clientY - pan.startY) > DRAG_THRESHOLD_PX) {
      movedRef.current = true
      // Take capture now, the first time this session crosses the drag
      // threshold, so a real drag keeps receiving pointermove even if the
      // cursor leaves the container mid-drag.
      e.currentTarget.setPointerCapture(e.pointerId)
      pan.captured = true
    }
    setViewport((vp) => panBy(vp, dx, dy))
  }, [])

  const endPan = useCallback((e: PointerEvent<HTMLElement>) => {
    const pinch = pinchRef.current
    if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) {
      pinchRef.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      const rest = [...pointersRef.current.entries()]
        .filter(([id, p]) => id !== e.pointerId && p.type !== 'mouse')
      if (rest.length === 1) {
        // Lifting one finger must not freeze the map until the other lifts too. The
        // survivor always becomes a PAN, never the brush it may have started as:
        // resuming a stroke from a finger that spent the last second pinching would
        // paint a line the operator never drew.
        const [id, p] = rest[0]
        panStateRef.current = {
          pointerId: id, lastX: p.x, lastY: p.y, startX: p.x, startY: p.y, captured: false,
        }
        movedRef.current = true
        return
      }
      setIsPanning(false)
      return
    }
    const pan = panStateRef.current
    if (pan && pan.pointerId === e.pointerId) {
      if (pan.captured && e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      panStateRef.current = null
    }
    setIsPanning(false)
  }, [])

  const didDrag = useCallback(() => movedRef.current, [])

  // ── Keyboard: arrows pan, +/- zoom at center, 0 fits ────────────────────
  const zoomAtCenter = useCallback((factor: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setViewport((vp) => zoomByFactor(vp, factor, rect.width / 2, rect.height / 2))
  }, [])

  const zoomIn = useCallback(() => zoomAtCenter(BUTTON_ZOOM_FACTOR), [zoomAtCenter])
  const zoomOut = useCallback(() => zoomAtCenter(1 / BUTTON_ZOOM_FACTOR), [zoomAtCenter])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        setViewport((vp) => panBy(vp, 0, PAN_STEP_PX))
        break
      case 'ArrowDown':
        e.preventDefault()
        setViewport((vp) => panBy(vp, 0, -PAN_STEP_PX))
        break
      case 'ArrowLeft':
        e.preventDefault()
        setViewport((vp) => panBy(vp, PAN_STEP_PX, 0))
        break
      case 'ArrowRight':
        e.preventDefault()
        setViewport((vp) => panBy(vp, -PAN_STEP_PX, 0))
        break
      case '+':
      case '=':
        e.preventDefault()
        zoomIn()
        break
      case '-':
        e.preventDefault()
        zoomOut()
        break
      case '0':
        e.preventDefault()
        fit()
        break
      default:
        break
    }
  }, [zoomIn, zoomOut, fit])

  return {
    viewport,
    containerRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPan,
      onPointerCancel: endPan,
      onKeyDown,
    },
    fit,
    zoomIn,
    zoomOut,
    isPanning,
    didDrag,
    coarsePointer,
    track,
    startPinch,
  }
}
