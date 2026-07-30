import { describe, it, expect } from 'vitest'
import {
  allocate,
  BASE_Z,
  MAX_STACK_DEPTH,
  TOAST_Z,
  Z_STEP,
  zIndexOf,
  type StackEntry,
} from '../components/ui/overlayStack'

describe('TOAST_Z', () => {
  it('is derived from BASE_Z and Z_STEP, not hardcoded', () => {
    expect(TOAST_Z).toBe(BASE_Z + MAX_STACK_DEPTH * Z_STEP)
  })

  // The regression this guards: the layout designer lives inside a full-screen
  // Modal, so a toast below the overlay stack renders under a blurred backdrop and
  // is unreadable — which is how a save error became invisible in the first place.
  it('clears a stack far deeper than anything the app opens', () => {
    let stack: StackEntry[] = []
    for (let i = 0; i < 40; i++) stack = allocate(stack, i)
    expect(TOAST_Z).toBeGreaterThan(zIndexOf(stack, 39))
  })
})
