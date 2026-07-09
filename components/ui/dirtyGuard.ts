// Guards a dismiss request against unsaved edits.
//
// Every way of closing an overlay (Escape, backdrop click, the X, Cancel) funnels
// through one `requestClose`. When the form is dirty the first attempt opens a
// discard confirmation instead of closing, so a stray backdrop click can't throw
// away a half-filled form.

export type GuardState = 'idle' | 'confirming'

export type GuardEvent =
  | { type: 'requestClose'; dirty: boolean }
  | { type: 'confirmDiscard' }
  | { type: 'cancelDiscard' }

export type GuardEffect = 'close' | 'open-confirm' | 'none'

export interface GuardResult {
  state: GuardState
  effect: GuardEffect
}

export function guardReducer(state: GuardState, event: GuardEvent): GuardResult {
  switch (event.type) {
    case 'requestClose':
      // A second dismiss attempt while the confirm is already up changes nothing;
      // the confirm itself is topmost and owns Escape.
      if (state === 'confirming') return { state, effect: 'none' }
      return event.dirty
        ? { state: 'confirming', effect: 'open-confirm' }
        : { state: 'idle', effect: 'close' }
    case 'confirmDiscard':
      return { state: 'idle', effect: 'close' }
    case 'cancelDiscard':
      return { state: 'idle', effect: 'none' }
  }
}
