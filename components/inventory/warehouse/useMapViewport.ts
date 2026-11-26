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
//
// ── Motion (NX-0047) ────────────────────────────────────────────────────────
// The map MOVES rather than jumps: the zoom buttons, + - 0, Fit and a floor change
// ease to their target over ZOOM_ANIM_MS; a fast pan glides to a stop when
// released. Under prefers-reduced-motion — and wherever that cannot be asked, as
// in jsdom — every one of those jumps instead. Any new press, wheel or pinch
// cancels a move in flight, so the map never fights the operator's hand.
//
// `settledScale` is the scale the SCENE is drawn at. The live scale goes on the
// <g transform> every frame; the settled one changes only once a zoom stops (an
// animation's last frame, a pinch's end, ~SETTLE_MS after the last wheel tick), so
// a zoom re-renders the ~945-level scene once instead of on every frame.

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type PointerEvent, type KeyboardEvent } from 'react'
import type { LayoutPlacement, LayoutObject } from '@/types'
import { BASE_CELL } from '@/components/admin/layout/layoutPalette'
import {
  type ScaleLimits,
  type Viewport,
  DEFAULT_SCALE_LIMITS,
  applyPinch,
  contentBounds,
  fitToBounds,
  interpolateViewport,
  panBy,
  scaleLimitsForFit,
  zoomByFactor,
} from './mapViewport'

/** Affordances only — never a capability gate. See the header. */
const COARSE_POINTER_QUERY = '(pointer: coarse)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const DRAG_THRESHOLD_PX = 4
const PAN_STEP_PX = 48
const BUTTON_ZOOM_FACTOR = 1.2
const FIT_PADDING = 32

/** Wheel zoom is continuous: the factor is exp(-pixels × this). A mouse notch
 *  (~100 px) is ×1.16; a trackpad's few pixels a matching nudge. */
const WHEEL_ZOOM_PER_PX = 0.0015
/** One event never zooms more than this, however large its delta. */
const WHEEL_MAX_STEP = 2
/** deltaMode 1 (lines) and 2 (pages) in pixels, so every wheel speaks one unit. */
const WHEEL_LINE_PX = 16
const WHEEL_PAGE_PX = 800

const ZOOM_ANIM_MS = 220
/** How long after the last wheel tick the zoom is treated as finished. */
const SETTLE_MS = 120

/** Release velocity is measured over this much of the drag's tail. */
const VELOCITY_WINDOW_MS = 80
/** Slower than this at release (px/ms) and the map simply stops. */
const MIN_GLIDE_SPEED = 0.25
/** Friction: velocity decays by e every this many ms. */
const GLIDE_TAU_MS = 325
/** The glide ends once it is this slow (px/ms). */
const GLIDE_STOP_SPEED = 0.02

interface MotionSample {
  t: number
  x: number
  y: number
}

interface PanState {
  pointerId: number
  lastX: number
  lastY: number
  startX: number
  startY: number
  /** Whether setPointerCapture was actually taken for this pointer session —
   *  only true once the drag threshold is crossed (see onPointerMove). */
  captured: boolean
  /** The drag's recent positions, for the release velocity. */
  samples: MotionSample[]
  /** The survivor of a pinch: it pans, but never glides (a finger that has just
   *  been pinching has no honest throw velocity). */
  fromPinch: boolean
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

/** A move in flight: an eased tween or a momentum glide. */
interface Motion {
  frame: number
  /** A tween's destination, so a second button press chains from it. */
  target: Viewport | null
  /** Whether the tween is a zoom about a fixed point. */
  anchored: boolean
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
  /** The scale the scene is drawn at — see the header. */
  settledScale: number
  /** True while an animation or a glide is moving the map. */
  inMotion: boolean
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

/** Whether to animate at all. Asked at the moment of moving, so a preference
 *  changed mid-session is honoured. Where it cannot be asked, do not animate. */
function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  if (typeof window.requestAnimationFrame !== 'function') return false
  return !window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/** A wheel event's vertical travel in pixels, whatever unit it was reported in. */
function wheelPixels(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * WHEEL_LINE_PX
  if (e.deltaMode === 2) return e.deltaY * WHEEL_PAGE_PX
  return e.deltaY
}

/** Zoom factor for one wheel event: continuous in its distance, capped per event. */
export function wheelZoomFactor(pixels: number): number {
  if (!Number.isFinite(pixels)) return 1
  const factor = Math.exp(-pixels * WHEEL_ZOOM_PER_PX)
  return Math.min(WHEEL_MAX_STEP, Math.max(1 / WHEEL_MAX_STEP, factor))
}

/** Release velocity (px/ms) from the drag's tail; zero if the hand had stopped. */
function releaseVelocity(samples: MotionSample[], now: number): { x: number; y: number } {
  const last = samples[samples.length - 1]
  if (!last || now - last.t > VELOCITY_WINDOW_MS) return { x: 0, y: 0 }
  const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS) ?? last
  const dt = last.t - first.t
  if (dt <= 0) return { x: 0, y: 0 }
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt }
}

export function useMapViewport({ placements, objects, floor }: UseMapViewportArgs): UseMapViewportResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, tx: 0, ty: 0 })
  const [settledScale, setSettledScale] = useState(1)
  const [inMotion, setInMotion] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [coarsePointer, setCoarsePointer] = useState<boolean>(matchesCoarsePointer)

  const panStateRef = useRef<PanState | null>(null)
  const movedRef = useRef(false)
  const hasSizedRef = useRef(false)
  const pointersRef = useRef(new Map<number, TrackedPointer>())
  const pinchRef = useRef<PinchState | null>(null)
  const motionRef = useRef<Motion | null>(null)
  const limitsRef = useRef<ScaleLimits>(DEFAULT_SCALE_LIMITS)
  const lastWheelRef = useRef(-Infinity)
  const lastFitFloorRef = useRef<number | null>(null)
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

  // ── Motion ────────────────────────────────────────────────────────────────
  const stopMotion = useCallback(() => {
    const m = motionRef.current
    if (!m) return
    window.cancelAnimationFrame(m.frame)
    motionRef.current = null
    setInMotion(false)
  }, [])

  useEffect(() => () => {
    const m = motionRef.current
    if (m && typeof window !== 'undefined') window.cancelAnimationFrame(m.frame)
  }, [])

  /** Ease to `target`; jump where motion is unwelcome. `anchor` makes it a zoom
   *  about that point (see interpolateViewport). */
  const animateTo = useCallback((target: Viewport, anchor?: { x: number; y: number }) => {
    const running = motionRef.current
    stopMotion()
    if (!motionAllowed()) {
      setViewport(target)
      return
    }
    const from = viewportRef.current
    // Chaining off an unanchored move (a Fit still in flight) cannot keep a fixed
    // point that the move it interrupts never had.
    const anchorFor = running && !running.anchored ? undefined : anchor
    const start = performance.now()
    const motion: Motion = { frame: 0, target, anchored: anchorFor != null }
    const step = (now: number) => {
      if (motionRef.current !== motion) return
      const t = (now - start) / ZOOM_ANIM_MS
      if (t >= 1) {
        motionRef.current = null
        setInMotion(false)
        setViewport(target)
        return
      }
      setViewport(interpolateViewport(from, target, t, anchorFor))
      motion.frame = window.requestAnimationFrame(step)
    }
    motionRef.current = motion
    setInMotion(true)
    motion.frame = window.requestAnimationFrame(step)
  }, [stopMotion])

  /** Let a released pan coast to a stop under friction. */
  const glide = useCallback((velocity: { x: number; y: number }) => {
    stopMotion()
    if (!motionAllowed()) return
    if (Math.hypot(velocity.x, velocity.y) < MIN_GLIDE_SPEED) return
    let v = velocity
    let prev = performance.now()
    const motion: Motion = { frame: 0, target: null, anchored: false }
    const step = (now: number) => {
      if (motionRef.current !== motion) return
      const dt = Math.max(0, now - prev)
      prev = now
      const decay = Math.exp(-dt / GLIDE_TAU_MS)
      v = { x: v.x * decay, y: v.y * decay }
      if (Math.hypot(v.x, v.y) < GLIDE_STOP_SPEED) {
        motionRef.current = null
        setInMotion(false)
        return
      }
      setViewport((vp) => panBy(vp, v.x * dt, v.y * dt))
      motion.frame = window.requestAnimationFrame(step)
    }
    motionRef.current = motion
    setInMotion(true)
    motion.frame = window.requestAnimationFrame(step)
  }, [stopMotion])

  // ── Settled scale ─────────────────────────────────────────────────────────
  useEffect(() => {
    const zooming = motionRef.current?.target != null
      || pinchRef.current != null
      || performance.now() - lastWheelRef.current < SETTLE_MS
    if (!zooming) {
      setSettledScale(viewport.scale)
      return
    }
    const timer = setTimeout(() => setSettledScale(viewportRef.current.scale), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [viewport.scale])

  // ── Fit-to-content ───────────────────────────────────────────────────────
  /** The fitted view for this floor, or null when there is nothing to measure.
   *  Also widens the zoom range so a floor that only fits below the default
   *  minimum can still be zoomed out past its fit (NX-0047 A6). */
  const fitTarget = useCallback((): Viewport | null => {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (!(rect.width > 0) || !(rect.height > 0)) return null
    const bounds = contentBounds(placements, objects, floor, BASE_CELL)
    if (!bounds) {
      limitsRef.current = DEFAULT_SCALE_LIMITS
      return { scale: 1, tx: 0, ty: 0 }
    }
    const target = fitToBounds(bounds, { width: rect.width, height: rect.height }, FIT_PADDING)
    limitsRef.current = scaleLimitsForFit(target.scale)
    return target
  }, [placements, objects, floor])

  const fitWith = useCallback((animate: boolean) => {
    const target = fitTarget()
    if (!target) return
    lastFitFloorRef.current = floor
    if (animate) {
      animateTo(target)
    } else {
      stopMotion()
      setViewport(target)
    }
  }, [fitTarget, floor, animateTo, stopMotion])

  const fit = useCallback(() => fitWith(true), [fitWith])

  // Fit on mount, on a floor change, and when the first content arrives — NOT
  // whenever the content changes. `fit` is rebuilt on every new `objects` array,
  // and painting one area cell builds one: keyed on `fit`, this threw the
  // operator back to the whole floor on every painted cell (NX-0046). Anything
  // else that wants the whole floor back has the Fit button.
  // A floor CHANGE animates; the first fit of all jumps, since there is nothing
  // on screen yet to move from.
  const fitRef = useRef(fitWith)
  fitRef.current = fitWith
  const hasContent = useMemo(
    () => contentBounds(placements, objects, floor, BASE_CELL) != null,
    [placements, objects, floor],
  )
  useEffect(() => {
    const previous = lastFitFloorRef.current
    fitRef.current(previous != null && previous !== floor)
  }, [floor, hasContent])

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
        fitRef.current(false)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
      stopMotion()
      lastWheelRef.current = performance.now()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const factor = wheelZoomFactor(wheelPixels(e))
      setViewport((vp) => zoomByFactor(vp, factor, cx, cy, limitsRef.current))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [stopMotion])

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
    stopMotion()
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
  }, [stopMotion])

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // A press stops the map dead, wherever it was going.
    stopMotion()
    panStateRef.current = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      captured: false,
      samples: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
      fromPinch: false,
    }
    movedRef.current = false
    setIsPanning(true)
  }, [stopMotion])

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
      }, limitsRef.current))
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
    const now = performance.now()
    // Keep only the tail the release velocity is measured over.
    pan.samples = [...pan.samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS), { t: now, x: e.clientX, y: e.clientY }]
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
      // The pinch has ended: draw the scene at the scale it ended on.
      setSettledScale(viewportRef.current.scale)
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
          samples: [], fromPinch: true,
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
      // Only a real drag throws; a cancelled pointer (the OS took it) never does.
      if (pan.captured && !pan.fromPinch && e.type !== 'pointercancel') {
        glide(releaseVelocity(pan.samples, performance.now()))
      }
    }
    setIsPanning(false)
  }, [glide])

  const didDrag = useCallback(() => movedRef.current, [])

  // ── Keyboard: arrows pan, +/- zoom at center, 0 fits ────────────────────
  const zoomAtCenter = useCallback((factor: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const centre = { x: rect.width / 2, y: rect.height / 2 }
    // A second press while the first is still moving chains from where the
    // first was GOING, so two quick presses are two full steps.
    const base = motionRef.current?.target ?? viewportRef.current
    animateTo(zoomByFactor(base, factor, centre.x, centre.y, limitsRef.current), centre)
  }, [animateTo])

  const zoomIn = useCallback(() => zoomAtCenter(BUTTON_ZOOM_FACTOR), [zoomAtCenter])
  const zoomOut = useCallback(() => zoomAtCenter(1 / BUTTON_ZOOM_FACTOR), [zoomAtCenter])

  const panStep = useCallback((dx: number, dy: number) => {
    stopMotion()
    setViewport((vp) => panBy(vp, dx, dy))
  }, [stopMotion])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        panStep(0, PAN_STEP_PX)
        break
      case 'ArrowDown':
        e.preventDefault()
        panStep(0, -PAN_STEP_PX)
        break
      case 'ArrowLeft':
        e.preventDefault()
        panStep(PAN_STEP_PX, 0)
        break
      case 'ArrowRight':
        e.preventDefault()
        panStep(-PAN_STEP_PX, 0)
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
  }, [panStep, zoomIn, zoomOut, fit])

  return {
    viewport,
    settledScale,
    inMotion,
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
