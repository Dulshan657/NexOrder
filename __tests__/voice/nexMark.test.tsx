// The Nex mark component: when it draws on, when it shimmers and when it stays
// still. The motion itself is CSS keyed off data-nex-mark-phase; what is asserted
// here is the phase it is in at each moment.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { DRAW_ON_MS, NexMark, SHIMMER_MS, __resetNexMarkClock } from '@/components/voice/NexMark'

function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
}

const mark = (container: HTMLElement) => container.querySelector('[data-nex-mark]') as HTMLElement
const phase = (container: HTMLElement) => mark(container).getAttribute('data-nex-mark-phase')
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

beforeEach(() => {
  vi.useFakeTimers()
  __resetNexMarkClock()
  setReducedMotion(false)
  setHidden(false)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('NexMark', () => {
  it('draws on when mounted and shimmers on schedule', () => {
    const { container } = render(<NexMark variant="disc" size={56} />)
    const svg = mark(container)
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('data-nex-mark')).toBe('disc')
    expect(phase(container)).toBe('draw')
    expect(svg.getAttribute('data-nex-mark-playing')).toBe('true')

    advance(DRAW_ON_MS)
    expect(phase(container)).toBe('rest')

    advance(1700 - DRAW_ON_MS)
    expect(phase(container)).toBe('shimmer')
    advance(SHIMMER_MS)
    expect(phase(container)).toBe('rest')

    // All five idle shimmers, then nothing more however long it waits.
    advance(30000)
    expect(mark(container).getAttribute('data-nex-mark-shimmers')).toBe('5')
    advance(120000)
    expect(mark(container).getAttribute('data-nex-mark-shimmers')).toBe('5')
    expect(phase(container)).toBe('rest')
  })

  it('replays the shimmer when playToken changes', () => {
    const { container, rerender } = render(<NexMark variant="disc" size={56} playToken={0} />)
    advance(60000)
    expect(phase(container)).toBe('rest')

    rerender(<NexMark variant="disc" size={56} playToken={1} />)
    expect(phase(container)).toBe('shimmer')
    expect(mark(container).getAttribute('data-nex-mark-shimmers')).toBe('6')
    advance(SHIMMER_MS)
    expect(phase(container)).toBe('rest')
  })

  it('never takes the pointer, so a shimmer cannot swallow the click that started it', () => {
    // A press starts a shimmer, which remounts the shapes inside. Were one of them
    // the press's target, it would leave the DOM before the release and the browser
    // would drop the click (found on dev: the launcher stopped opening the sheet).
    const { container } = render(<NexMark variant="disc" size={56} />)
    const svg = mark(container)
    expect(svg.style.pointerEvents).toBe('none')
    expect(getComputedStyle(svg).pointerEvents).toBe('none')
  })

  it('ignores a hover or tap while it is still drawing on', () => {
    const { container, rerender } = render(<NexMark variant="disc" size={56} playToken={0} />)
    advance(500)
    rerender(<NexMark variant="disc" size={56} playToken={1} />)
    expect(phase(container)).toBe('draw')
    expect(mark(container).getAttribute('data-nex-mark-shimmers')).toBe('0')
    advance(DRAW_ON_MS - 500)
    expect(phase(container)).toBe('rest')
  })

  it('plays only what is left of the idle schedule when remounted', () => {
    const first = render(<NexMark variant="disc" size={56} />)
    advance(20000)
    expect(mark(first.container).getAttribute('data-nex-mark-shimmers')).toBe('3')
    first.unmount()

    // The launcher comes back when the sheet closes: it draws on again, then plays
    // only the shimmers still due (22 s and 29 s), not all five.
    const second = render(<NexMark variant="disc" size={56} />)
    expect(phase(second.container)).toBe('draw')
    advance(60000)
    expect(mark(second.container).getAttribute('data-nex-mark-shimmers')).toBe('2')
  })

  it('skips a shimmer while the tab is hidden', () => {
    const { container } = render(<NexMark variant="bare" size={20} />)
    setHidden(true)
    advance(2000)
    expect(phase(container)).toBe('rest')
    expect(mark(container).getAttribute('data-nex-mark-shimmers')).toBe('0')

    setHidden(false)
    advance(6000)
    expect(phase(container)).toBe('shimmer')
    expect(mark(container).getAttribute('data-nex-mark-shimmers')).toBe('1')
  })

  it('renders still and schedules nothing under reduced motion', () => {
    setReducedMotion(true)
    const { container, rerender } = render(<NexMark variant="disc" size={56} playToken={0} />)
    expect(phase(container)).toBe('rest')
    expect(mark(container).getAttribute('data-nex-mark-playing')).toBe('false')
    expect(vi.getTimerCount()).toBe(0)

    rerender(<NexMark variant="disc" size={56} playToken={1} />)
    expect(phase(container)).toBe('rest')
    expect(vi.getTimerCount()).toBe(0)
  })
})
