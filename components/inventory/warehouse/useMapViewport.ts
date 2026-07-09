// Owns the Warehouse map's pan/zoom interaction state: wheel-to-zoom,
// pointer-drag-to-pan, keyboard nav, and fit-to-content. All the actual math is
// in mapViewport.ts (pure, unit-tested) — this hook is just wiring: refs,
// event listeners, and the click-suppression flag a caller needs to stop a pan
// from also selecting a bin.
//
// Gestures (wheel/drag/keyboard) are disabled below the `md` breakpoint so
// mobile falls back to a static, fitted view with tap-to-select — see
// `gesturesEnabled`.

import { useCallback, useEffect, useRef, useState, type RefObject, type PointerEvent, type KeyboardEvent } from 'react'
import type { LayoutPlacement, LayoutObject } from '@/types'
import { BASE_CELL } from '@/components/admin/layout/layoutPalette'
import {
  type Viewport,
  contentBounds,
  fitToBounds,
  panBy,
  zoomByFactor,
} from './mapViewport'

const GESTURE_MEDIA_QUERY = '(min-width: 768px)'
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
  /** False below the `md` breakpoint — mobile gets a static fitted view. */
  gesturesEnabled: boolean
}

function matchesGestureBreakpoint(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia(GESTURE_MEDIA_QUERY).matches
}

export function useMapViewport({ placements, objects, floor }: UseMapViewportArgs): UseMapViewportResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, tx: 0, ty: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [gesturesEnabled, setGesturesEnabled] = useState<boolean>(matchesGestureBreakpoint)

  const panStateRef = useRef<PanState | null>(null)
  const movedRef = useRef(false)
  const hasSizedRef = useRef(false)

  // ── Media query: disable all gestures below md ──────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(GESTURE_MEDIA_QUERY)
    const onChange = () => setGesturesEnabled(mq.matches)
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
    if (!el || !gesturesEnabled) return
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
  }, [gesturesEnabled])

  // ── Drag to pan (Pointer Events) ─────────────────────────────────────────
  // Capture is taken lazily (see onPointerMove) rather than here: capturing on
  // every pointerdown routes the trailing `click` to the container instead of
  // the element under the cursor (Pointer Events spec), so a bin's onClick
  // never fired. A clean click now never captures at all.
  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!gesturesEnabled) return
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
  }, [gesturesEnabled])

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
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
    if (!gesturesEnabled) return
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
  }, [gesturesEnabled, zoomIn, zoomOut, fit])

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
    gesturesEnabled,
  }
}
