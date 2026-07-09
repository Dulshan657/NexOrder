import { describe, expect, it } from 'vitest'
import { BASE_Z, Z_STEP, allocate, isTopmost, release, zIndexOf } from '../../components/ui/overlayStack'
import { acquire, initialLockState, releaseLock, scrollbarWidthOf } from '../../components/ui/scrollLock'
import { nextTabIndex } from '../../components/ui/focusTrap'
import { guardReducer } from '../../components/ui/dirtyGuard'

describe('overlayStack', () => {
  it('places the first overlay at the base z-index', () => {
    const stack = allocate([], 1)
    expect(zIndexOf(stack, 1)).toBe(BASE_Z)
    expect(isTopmost(stack, 1)).toBe(true)
  })

  it('stacks a nested overlay above its parent and hands it Escape', () => {
    const stack = allocate(allocate([], 1), 2)
    expect(zIndexOf(stack, 1)).toBe(BASE_Z)
    expect(zIndexOf(stack, 2)).toBe(BASE_Z + Z_STEP)
    expect(isTopmost(stack, 1)).toBe(false)
    expect(isTopmost(stack, 2)).toBe(true)
  })

  it('restores the parent as topmost when the child closes', () => {
    const stack = release(allocate(allocate([], 1), 2), 2)
    expect(isTopmost(stack, 1)).toBe(true)
    expect(stack).toHaveLength(1)
  })

  it('keeps ordering when a middle entry is released', () => {
    const stack = release(allocate(allocate(allocate([], 1), 2), 3), 2)
    expect(stack.map((e) => e.id)).toEqual([1, 3])
    expect(zIndexOf(stack, 3)).toBe(BASE_Z + Z_STEP)
  })

  it('never mutates the input stack', () => {
    const original = allocate([], 1)
    allocate(original, 2)
    release(original, 1)
    expect(original).toHaveLength(1)
  })

  it('clears everything AppShell uses', () => {
    // AppShell's highest layer is z-50.
    expect(BASE_Z).toBeGreaterThan(50)
  })
})

describe('scrollLock', () => {
  it('measures the scrollbar gutter', () => {
    expect(scrollbarWidthOf({ offsetWidth: 1015, clientWidth: 1000 })).toBe(15)
  })

  it('reports no gutter when the scroller has none', () => {
    expect(scrollbarWidthOf({ offsetWidth: 1000, clientWidth: 1000 })).toBe(0)
    expect(scrollbarWidthOf({ offsetWidth: 990, clientWidth: 1000 })).toBe(0)
  })

  it('writes styles only on the first acquire', () => {
    const first = acquire(initialLockState, 'auto', '0px')
    expect(first.apply).toBe(true)
    expect(first.next.count).toBe(1)

    const second = acquire(first.next, 'auto', '0px')
    expect(second.apply).toBe(false)
    expect(second.next.count).toBe(2)
  })

  it('restores styles only when the last overlay closes', () => {
    const nested = acquire(acquire(initialLockState, 'auto', '4px').next, 'auto', '4px').next

    const inner = releaseLock(nested)
    expect(inner.restore).toBe(false)
    expect(inner.next.count).toBe(1)

    const outer = releaseLock(inner.next)
    expect(outer.restore).toBe(true)
    expect(outer.next.count).toBe(0)
  })

  it('remembers the styles captured at first lock', () => {
    const state = acquire(initialLockState, 'auto', '4px').next
    expect(state.prevOverflow).toBe('auto')
    expect(state.prevPaddingRight).toBe('4px')
  })

  it('is a no-op when released below zero', () => {
    const result = releaseLock(initialLockState)
    expect(result.restore).toBe(false)
    expect(result.next.count).toBe(0)
  })
})

describe('focusTrap.nextTabIndex', () => {
  it('advances and wraps forward', () => {
    expect(nextTabIndex(3, 0, false)).toBe(1)
    expect(nextTabIndex(3, 2, false)).toBe(0)
  })

  it('advances and wraps backward', () => {
    expect(nextTabIndex(3, 2, true)).toBe(1)
    expect(nextTabIndex(3, 0, true)).toBe(2)
  })

  it('pulls focus back inside when it has escaped the panel', () => {
    expect(nextTabIndex(3, -1, false)).toBe(0)
    expect(nextTabIndex(3, -1, true)).toBe(2)
  })

  it('reports no target for an empty panel', () => {
    expect(nextTabIndex(0, 0, false)).toBe(-1)
  })
})

describe('dirtyGuard', () => {
  it('closes immediately when the form is clean', () => {
    expect(guardReducer('idle', { type: 'requestClose', dirty: false })).toEqual({
      state: 'idle',
      effect: 'close',
    })
  })

  it('opens the discard confirm when the form is dirty', () => {
    expect(guardReducer('idle', { type: 'requestClose', dirty: true })).toEqual({
      state: 'confirming',
      effect: 'open-confirm',
    })
  })

  it('closes once discard is confirmed', () => {
    expect(guardReducer('confirming', { type: 'confirmDiscard' })).toEqual({
      state: 'idle',
      effect: 'close',
    })
  })

  it('stays open when discard is cancelled', () => {
    expect(guardReducer('confirming', { type: 'cancelDiscard' })).toEqual({
      state: 'idle',
      effect: 'none',
    })
  })

  it('ignores further dismiss attempts while the confirm is up', () => {
    expect(guardReducer('confirming', { type: 'requestClose', dirty: true })).toEqual({
      state: 'confirming',
      effect: 'none',
    })
  })
})
