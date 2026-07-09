import { useEffect, useRef, useSyncExternalStore } from 'react'
import { allocate, isTopmost, release, zIndexOf, type StackEntry } from './overlayStack'

// One module-level stack shared by every mounted overlay. Entries are appended on
// open and removed on close, so insertion order is stack order.

let stack: readonly StackEntry[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): readonly StackEntry[] {
  return stack
}

/** Server snapshot: no overlays exist during SSR/prerender. */
const EMPTY: readonly StackEntry[] = []

export interface ModalStackSlot {
  z: number
  isTopmost: boolean
}

/**
 * Reserves a stack slot while `active`. Returns the z-index to render at and
 * whether this overlay currently owns Escape.
 */
export function useModalStack(active: boolean): ModalStackSlot {
  const idRef = useRef(0)
  if (idRef.current === 0) idRef.current = nextId++
  const id = idRef.current

  useEffect(() => {
    if (!active) return
    stack = allocate(stack, id)
    emit()
    return () => {
      stack = release(stack, id)
      emit()
    }
  }, [active, id])

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
  return { z: zIndexOf(snapshot, id), isTopmost: isTopmost(snapshot, id) }
}

/** Test-only: drop all entries between cases. */
export function __resetModalStack(): void {
  stack = []
  nextId = 1
  emit()
}
