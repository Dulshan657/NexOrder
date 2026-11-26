// NX-0046 A1: the map keeps the operator's zoom while they work.
//
// The hook used to re-fit whenever the object list changed IDENTITY, and painting
// one area cell builds a new list — so every painted cell threw the operator back
// to the whole floor. A re-fit belongs to first size, a floor change, the first
// content to arrive, and the Fit button.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { LayoutObject, LayoutPlacement } from '@/types'
import { useMapViewport, type UseMapViewportResult } from '@/components/inventory/warehouse/useMapViewport'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// jsdom has no layout: give the stage a real size or fit() is a no-op.
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect
  }
})

const placements = [
  { id: 1, layoutId: 1, locationId: 1, floor: 0, x: 0, y: 0, w: 2, h: 1, rotation: 0 },
  { id: 2, layoutId: 1, locationId: 2, floor: 0, x: 60, y: 40, w: 2, h: 1, rotation: 0 },
  { id: 3, layoutId: 1, locationId: 3, floor: 1, x: 0, y: 0, w: 2, h: 1, rotation: 0 },
] as LayoutPlacement[]

const area = (id: number, x: number): LayoutObject =>
  ({ id, layoutId: 1, objectType: 'area', floor: 0, x, y: 5, w: 1, h: 1, meta: { name: 'Fast' } }) as LayoutObject

type HarnessProps = {
  objects: LayoutObject[]
  floor?: number
  rows?: LayoutPlacement[]
  onHook?: (vp: UseMapViewportResult) => void
}

function Harness({ objects, floor = 0, rows = placements, onHook }: HarnessProps) {
  const vp = useMapViewport({ placements: rows, objects, floor })
  onHook?.(vp)
  return (
    <div ref={vp.containerRef} data-testid="stage">
      <button type="button" onClick={vp.zoomIn}>in</button>
      <button type="button" onClick={vp.fit}>fit</button>
      <output data-testid="scale">{vp.viewport.scale}</output>
      <output data-testid="tx">{vp.viewport.tx}</output>
    </div>
  )
}

const scale = () => Number(screen.getByTestId('scale').textContent)
const tx = () => Number(screen.getByTestId('tx').textContent)

// ── NX-0047: a clock the test drives ────────────────────────────────────────
// Animation frames and performance.now() both read `clock`; `advance` steps it
// in 16 ms frames and runs whatever frames were requested, as a browser would.
// matchMedia is stubbed to say motion is welcome: jsdom has no matchMedia, and
// the hook treats "cannot ask" as "do not animate".
function motionClock() {
  let clock = 1000
  let queue: FrameRequestCallback[] = []
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length })
  vi.stubGlobal('cancelAnimationFrame', () => { queue = [] })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener() {}, removeEventListener() {},
  }))
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      clock += 16
      const frames = queue
      queue = []
      act(() => { frames.forEach((cb) => cb(clock)) })
    }
  }
  const tick = (ms: number) => { clock += ms }
  return { advance, tick }
}

const captureTarget = {
  setPointerCapture() {},
  hasPointerCapture() { return true },
  releasePointerCapture() {},
}
const pointer = (type: string, x: number, y: number) =>
  ({ type, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, currentTarget: captureTarget }) as never

describe('useMapViewport', () => {
  it('keeps the zoom when the object list is replaced', () => {
    const { rerender } = render(<Harness objects={[area(1, 5)]} />)
    const fitted = scale()
    fireEvent.click(screen.getByText('in'))
    const zoomed = scale()
    expect(zoomed).toBeGreaterThan(fitted)

    // One more painted cell: a NEW array, as RackedWorkspace builds per stroke.
    rerender(<Harness objects={[area(1, 5), area(2, 6)]} />)
    expect(scale()).toBe(zoomed)
  })

  it('still re-fits on a floor change and on the Fit button', () => {
    const { rerender } = render(<Harness objects={[]} />)
    const fitted = scale()
    fireEvent.click(screen.getByText('in'))
    expect(scale()).toBeGreaterThan(fitted)
    fireEvent.click(screen.getByText('fit'))
    expect(scale()).toBe(fitted)

    fireEvent.click(screen.getByText('in'))
    const zoomed = scale()
    rerender(<Harness objects={[]} floor={1} />)
    expect(scale()).not.toBe(zoomed)
  })

  it('fits when the first content arrives after an empty load', () => {
    const { rerender } = render(<Harness objects={[]} rows={[]} />)
    expect(scale()).toBe(1)
    rerender(<Harness objects={[]} />)
    expect(scale()).toBeLessThan(1)
  })

  it('Fit animates to the fitted view instead of jumping', () => {
    const { advance } = motionClock()
    render(<Harness objects={[]} />)
    const fitted = scale()
    fireEvent.click(screen.getByText('in'))
    advance(400)
    const zoomed = scale()
    expect(zoomed).toBeGreaterThan(fitted)

    fireEvent.click(screen.getByText('fit'))
    // Not there yet: the map moves, it does not jump.
    expect(scale()).toBe(zoomed)
    advance(96)
    expect(scale()).toBeLessThan(zoomed)
    expect(scale()).toBeGreaterThan(fitted)
    advance(400)
    expect(scale()).toBeCloseTo(fitted, 9)
  })

  it('a wheel zoom scales with the scroll distance', () => {
    render(<Harness objects={[]} />)
    const stage = screen.getByTestId('stage')
    const wheel = (deltaY: number) => {
      const before = scale()
      act(() => {
        stage.dispatchEvent(new WheelEvent('wheel', {
          deltaY, ctrlKey: true, clientX: 400, clientY: 300, bubbles: true, cancelable: true,
        }))
      })
      return scale() / before
    }
    const small = wheel(-4)
    const large = wheel(-100)
    expect(small).toBeGreaterThan(1)
    expect(large).toBeGreaterThan(small)
    // A trackpad's few pixels is a nudge, not a full notch.
    expect(small).toBeLessThan(1.05)
  })

  it('a released fast pan keeps gliding', () => {
    const { advance, tick } = motionClock()
    let hook: UseMapViewportResult | null = null
    render(<Harness objects={[]} onHook={(vp) => { hook = vp }} />)
    act(() => hook!.handlers.onPointerDown(pointer('pointerdown', 100, 100)))
    for (let i = 1; i <= 5; i++) {
      tick(16)
      act(() => hook!.handlers.onPointerMove(pointer('pointermove', 100 + i * 20, 100)))
    }
    act(() => hook!.handlers.onPointerUp(pointer('pointerup', 200, 100)))
    const released = tx()
    advance(160)
    expect(tx()).toBeGreaterThan(released)
    advance(3000)
    // ...and it comes to rest rather than drifting forever.
    const rested = tx()
    advance(500)
    expect(tx()).toBe(rested)
  })

  /** A fast drag released: the map is left gliding. */
  function throwPan(hook: () => UseMapViewportResult, tick: (ms: number) => void) {
    act(() => hook().handlers.onPointerDown(pointer('pointerdown', 100, 100)))
    for (let i = 1; i <= 5; i++) {
      tick(16)
      act(() => hook().handlers.onPointerMove(pointer('pointermove', 100 + i * 20, 100)))
    }
    act(() => hook().handlers.onPointerUp(pointer('pointerup', 200, 100)))
  }

  // A tap that halts a coasting map is a STOP, not a click: on the handheld it
  // would otherwise select whatever bin happened to slide under the finger.
  it('a press that stops a glide does not count as a click', () => {
    const { advance, tick } = motionClock()
    let hook: UseMapViewportResult | null = null
    render(<Harness objects={[]} onHook={(vp) => { hook = vp }} />)
    throwPan(() => hook!, tick)
    advance(48)
    act(() => hook!.handlers.onPointerDown(pointer('pointerdown', 300, 300)))
    act(() => hook!.handlers.onPointerUp(pointer('pointerup', 300, 300)))
    expect(hook!.didDrag()).toBe(true)
    // The glide is over: the map stays where the tap stopped it.
    const stopped = tx()
    advance(300)
    expect(tx()).toBe(stopped)

    // A tap on a map at rest is still a click.
    act(() => hook!.handlers.onPointerDown(pointer('pointerdown', 300, 300)))
    act(() => hook!.handlers.onPointerUp(pointer('pointerup', 300, 300)))
    expect(hook!.didDrag()).toBe(false)
  })

  it('jumps instead of moving when the operator prefers reduced motion', () => {
    const { advance, tick } = motionClock()
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {},
    }))
    let hook: UseMapViewportResult | null = null
    render(<Harness objects={[]} onHook={(vp) => { hook = vp }} />)
    const fitted = scale()
    fireEvent.click(screen.getByText('in'))
    expect(scale()).toBeGreaterThan(fitted)
    fireEvent.click(screen.getByText('fit'))
    expect(scale()).toBe(fitted)

    // ...and a thrown pan stops where the hand let go.
    throwPan(() => hook!, tick)
    const released = tx()
    advance(300)
    expect(tx()).toBe(released)
  })

  // The finger left over from a pinch pans, but has no honest throw velocity.
  it('the finger left after a pinch does not glide', () => {
    const { advance, tick } = motionClock()
    let hook: UseMapViewportResult | null = null
    render(<Harness objects={[]} onHook={(vp) => { hook = vp }} />)
    const touch = (type: string, id: number, x: number, y: number) =>
      ({ type, pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y, currentTarget: captureTarget }) as never
    act(() => {
      hook!.track(touch('pointerdown', 1, 100, 100))
      hook!.handlers.onPointerDown(touch('pointerdown', 1, 100, 100))
      hook!.track(touch('pointerdown', 2, 200, 100))
      hook!.startPinch(touch('pointerdown', 2, 200, 100))
    })
    // Lift finger 2: finger 1 becomes the survivor pan.
    act(() => {
      hook!.track(touch('pointerup', 2, 200, 100))
      hook!.handlers.onPointerUp(touch('pointerup', 2, 200, 100))
    })
    for (let i = 1; i <= 5; i++) {
      tick(16)
      act(() => {
        hook!.track(touch('pointermove', 1, 100 + i * 20, 100))
        hook!.handlers.onPointerMove(touch('pointermove', 1, 100 + i * 20, 100))
      })
    }
    act(() => {
      hook!.track(touch('pointerup', 1, 200, 100))
      hook!.handlers.onPointerUp(touch('pointerup', 1, 200, 100))
    })
    const released = tx()
    advance(300)
    expect(tx()).toBe(released)
  })
})
