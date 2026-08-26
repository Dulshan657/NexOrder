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

/**
 * App chrome that has to be PORTALLED but is not an overlay.
 *
 * The notification panel is the case: it hangs off a bell inside the sidebar,
 * and the sidebar carries `backdrop-blur-md`, which makes it a containing block
 * — so a `position: fixed` child positions against the sidebar rather than the
 * viewport, and the panel cannot be clamped to the screen from inside it. It
 * therefore portals to document.body like an overlay, but it must NOT outrank
 * one: a Modal opened over it has to cover it, and it traps no focus and
 * handles no Escape of its own.
 *
 * Hence below BASE_Z, and above AppShell's own z-50 chrome.
 */
export const CHROME_Z = BASE_Z - 10

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

/** Depth the stack is allowed to reach before the toast layer would be swallowed.
 *  Today's deepest real nesting is Modal → Modal → ConfirmDialog (1000/1010/1020),
 *  so 100 slots is ~30× headroom. */
export const MAX_STACK_DEPTH = 100

/**
 * Toasts render ABOVE every overlay, rather than taking a slot of their own.
 *
 * A toast owns nothing the stack exists to arbitrate — it never traps focus and
 * never handles Escape — and it is usually raised BY overlay content. The layout
 * designer is mounted inside a `<Modal size="full">`, so at the old bare `z-50`
 * every toast it raised rendered UNDER that modal's `bg-stone-900/60
 * backdrop-blur-sm` container: dimmed AND blurred, i.e. unreadable. Which meant
 * the one surface that reports why a save failed was the one surface you
 * couldn't read it on.
 *
 * Derived from BASE_Z/Z_STEP so it tracks them if they ever move.
 */
export const TOAST_Z = BASE_Z + MAX_STACK_DEPTH * Z_STEP
