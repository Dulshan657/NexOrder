// Who owns the product shown in the 3D find bar (NX-0046).
//
// Two things can put a product there: the operator, picking one in the bar, and
// the engine ("Find a product" in Ask the engine). The engine's highlight used
// to be mirrored straight into the bar's state, so clearing it also cleared a
// product the operator had picked themselves. Tracking who set it is the fix.
//
// Pure, so it is testable without WebGL.

export interface FindState {
  productId: number | null
  /** True while the product shown came from the engine, not the operator. */
  fromEngine: boolean
}

export const EMPTY_FIND: FindState = { productId: null, fromEngine: false }

/** The operator picked (or cleared) a product in the bar. */
export function operatorFind(productId: number | null): FindState {
  return productId == null ? EMPTY_FIND : { productId, fromEngine: false }
}

/**
 * The engine's highlight changed. A product replaces whatever is shown; a clear
 * removes only what the engine itself put there. Returns the SAME object when
 * nothing changes, so a caller can set state from an effect without looping.
 */
export function nextFindProduct(state: FindState, engineFocus: number | null | undefined): FindState {
  if (engineFocus == null) return state.fromEngine ? EMPTY_FIND : state
  if (state.fromEngine && state.productId === engineFocus) return state
  return { productId: engineFocus, fromEngine: true }
}
