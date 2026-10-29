// The orb component, against a stub 2D context (jsdom has no canvas). What is
// asserted is WHEN it animates: a live orb runs, a burst orb runs only for a
// moment after it is triggered, and reduced motion gets one still frame.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { BURST_MS, NexOrb } from '@/components/voice/NexOrb'
import type { OrbVisual } from '@/components/voice/orbState'

const LISTENING: OrbVisual = { state: 'listening', tone: 'emerald', audio: 'mic', frozen: false }
const IDLE: OrbVisual = { state: 'breathing', tone: 'stone', audio: null, frozen: false }

function stubContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    lineWidth: 1,
  }
}

function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

let ctx: ReturnType<typeof stubContext>
const orb = (container: HTMLElement) => container.querySelector('[data-orb-state]') as HTMLElement

beforeEach(() => {
  ctx = stubContext()
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext
  setReducedMotion(false)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('NexOrb', () => {
  it('is decorative and says which state it draws', () => {
    const { container } = render(<NexOrb visual={LISTENING} size={96} animate="live" />)
    expect(orb(container).getAttribute('aria-hidden')).toBe('true')
    expect(orb(container).getAttribute('data-orb-state')).toBe('listening')
    expect(orb(container).getAttribute('data-orb-animate')).toBe('live')
    expect(orb(container).getAttribute('data-orb-playing')).toBe('true')
    expect(ctx.arc).toHaveBeenCalled()
  })

  it('a burst plays when triggered and stops after its duration', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<NexOrb visual={IDLE} size={20} animate="burst" playToken={0} />)
    expect(orb(container).getAttribute('data-orb-playing')).toBe('false')

    rerender(<NexOrb visual={IDLE} size={20} animate="burst" playToken={1} />)
    expect(orb(container).getAttribute('data-orb-playing')).toBe('true')

    act(() => {
      vi.advanceTimersByTime(BURST_MS + 50)
    })
    expect(orb(container).getAttribute('data-orb-playing')).toBe('false')
  })

  it('paints one static frame and requests no animation frame under reduced motion', () => {
    setReducedMotion(true)
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const { container } = render(<NexOrb visual={LISTENING} size={96} animate="live" />)
    expect(ctx.arc).toHaveBeenCalled()
    expect(raf).not.toHaveBeenCalled()
    expect(orb(container).getAttribute('data-orb-playing')).toBe('false')
  })

  it('holds a frozen orb still', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const { container } = render(<NexOrb visual={{ ...IDLE, tone: 'rose', frozen: true }} size={96} animate="live" />)
    expect(raf).not.toHaveBeenCalled()
    expect(orb(container).getAttribute('data-orb-playing')).toBe('false')
  })
})
