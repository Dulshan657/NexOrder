// Z-index allocation for stacked overlays.
//
// Every open overlay occupies one slot in a shared stack. Its z-index is derived
// from its position, so a modal opened on top of another always renders above it
// without anyone hand-picking `z-[60]`. Only the last entry is "topmost", which is
// what ESC keys off — so Escape closes the confirm dialog, not the form behind it.
//
// BASE_Z clears everything AppShell uses (its highest is z-50).

export const BASE_Z = 1000
export const Z_STEP = 10

export interface StackEntry {
  id: number
}

/** Push an entry onto the stack. Returns a new array; never mutates. */
export function allocate(stack: readonly StackEntry[], id: number): StackEntry[] {
  return [...stack, { id }]
}

/** Remove an entry by id. Safe to call for an id that isn't present. */
export function release(stack: readonly StackEntry[], id: number): StackEntry[] {
  return stack.filter((entry) => entry.id !== id)
}

/** Entries stack upward in insertion order. An unknown id sits at the base. */
export function zIndexOf(stack: readonly StackEntry[], id: number): number {
  const index = stack.findIndex((entry) => entry.id === id)
  return index === -1 ? BASE_Z : BASE_Z + index * Z_STEP
}

/** Only the most recently opened overlay handles Escape. */
export function isTopmost(stack: readonly StackEntry[], id: number): boolean {
  return stack.length > 0 && stack[stack.length - 1].id === id
}
