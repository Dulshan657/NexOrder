import { useState } from 'react'
import { NexOrb } from './NexOrb'
import type { OrbVisual } from './orbState'

// The floating button that opens Nex. `absolute` inside AppShell's `relative` content column, never
// `fixed`, so it is not an overlay (check:overlays) and cannot sit over the
// sidebar. On a phone it rides above the bottom-right controls some screens pin
// there (the Shop's checkout button, the pantry's bottom bar); from `lg` up those
// are gone and it drops to the corner. 56 px, so well over the 44 px touch floor.
//
// Its icon is Nex's orb, still, in white: there is never a session to show while
// the button is visible (closing the sheet ends it), so it plays only a short
// burst when pressed.

const LAUNCHER_ORB: OrbVisual = { state: 'breathing', tone: 'blue', audio: null, frozen: false }
const LAUNCHER_ORB_PX = 32

/** Focus returns here when the sheet closes (the button is unmounted while it is open). */
export const VOICE_BUTTON_ID = 'nex-assistant-launcher'

export interface VoiceAssistantButtonProps {
  onClick: () => void
}

export function VoiceAssistantButton({ onClick }: VoiceAssistantButtonProps) {
  const [presses, setPresses] = useState(0)
  return (
    <button
      type="button"
      id={VOICE_BUTTON_ID}
      aria-label="Talk to Nex"
      onPointerDown={() => setPresses((n: number) => n + 1)}
      onClick={onClick}
      className="absolute bottom-24 right-4 lg:bottom-4 z-30 h-14 w-14 inline-flex items-center justify-center rounded-full bg-nexgen-blue text-white shadow-card btn-press touch-target hover:bg-nexgen-blue-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-nexgen-blue-dark"
    >
      <NexOrb visual={LAUNCHER_ORB} size={LAUNCHER_ORB_PX} animate="burst" playToken={presses} ink="#ffffff" />
    </button>
  )
}
