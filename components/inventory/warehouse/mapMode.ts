// What the live map is currently FOR, and what that forbids.
//
// The map has grown three jobs — look at it, annotate it, recode it — and until now
// the exclusion between them was five hand-written conjunctions scattered through
// RackedWorkspace's JSX (`canRename && !paint.state.active`, `recode.state.active ?
// NOOP : selectFromMap`, and so on). Every new mode had to remember to appear in all
// five, and forgetting one is silent: the rename pencil stays live during a sweep,
// both rewrite `locations`, and the operator gets a rename computed against a
// picture the server has never seen.
//
// So the exclusion is derived once, here, and pure — which also makes it testable
// without a canvas.
//
// NOT a mode enum for MapStage. The differences between painting and selecting live
// at the GESTURE layer (eager vs lazy pointer capture, a clamped cell vs a null one
// out of bounds, whether Alt falls through to pan), not at the mode layer. MapStage
// keeps taking prop bags describing gestures; giving it a mode would make it know
// what a mode MEANS, which is exactly the knowledge the prop bags keep out of it.

export type MapMode = 'view' | 'annotate' | 'recode'

export interface MapModeInputs {
  paintActive: boolean
  recodeActive: boolean
}

/**
 * Recode wins a (should-be-impossible) tie.
 *
 * Both modes are entered from buttons that are only rendered in `view`, so the tie
 * cannot happen — but if it ever does, the sweep is the one holding an unsaved
 * selection the operator built by hand, and a paint working set is re-hydrated from
 * the server on entry. Losing the cheaper one is the better failure.
 */
export function deriveMapMode(inputs: MapModeInputs): MapMode {
  if (inputs.recodeActive) return 'recode'
  if (inputs.paintActive) return 'annotate'
  return 'view'
}

export interface ModeGuards {
  /** The ✎ pencil on an area name. */
  canRenameArea: boolean
  /** Click-through on a floor sign's text. */
  canEditSign: boolean
  /** Whether a bin click selects and scrolls Bin detail into view. */
  canSelectBin: boolean
  /** The header row of mode-entry buttons. */
  showModeButtons: boolean
}

/**
 * `canRename` is the Admin/Manager gate (mig 00094) and is orthogonal to the mode —
 * it decides whether an action exists at all, the mode decides whether it is
 * reachable right now.
 */
export function modeGuards(mode: MapMode, canRename: boolean): ModeGuards {
  return {
    // Both rewrite the same rows as the thing being edited.
    canRenameArea: canRename && mode === 'view',
    // Clicking a sign ENTERS annotate mode, so offering it inside one would
    // re-hydrate the working set and silently discard unsaved edits.
    canEditSign: canRename && mode === 'view',
    // A sweep's stroke must not double as a bin click, and Bin detail must not
    // scroll itself into view from behind the panel mid-selection.
    canSelectBin: mode !== 'recode',
    showModeButtons: canRename && mode === 'view',
  }
}
