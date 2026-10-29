import { useState } from 'react'
import { NexMark } from './NexMark'

// The floating button that opens Nex. `absolute` inside AppShell's `relative` content column, never
// `fixed`, so it is not an overlay (check:overlays) and cannot sit over the
// sidebar. On a phone it rides above the bottom-right controls some screens pin
// there (the Shop's checkout button, the pantry's bottom bar); from `lg` up those
// are gone and it drops to the corner. 56 px, so well over the 44 px touch floor.
//
// Its face is the Nex mark on its navy disc (NexMark variant="disc"): it draws
// itself on, shimmers a few times while the page is new, and again on each hover
// or tap. The disc IS the button's background, so the button paints none.

const LAUNCHER_PX = 56

/** Focus returns here when the sheet closes (the button is unmounted while it is open). */
export const VOICE_BUTTON_ID = 'nex-assistant-launcher'

export interface VoiceAssistantButtonProps {
  onClick: () => void
}

export function VoiceAssistantButton({ onClick }: VoiceAssistantButtonProps) {
  const [plays, setPlays] = useState(0)
  const replay = () => setPlays((n: number) => n + 1)
  return (
    <button
      type="button"
      id={VOICE_BUTTON_ID}
      aria-label="Talk to Nex"
      onPointerDown={replay}
      onPointerEnter={(event: PointerEvent) => {
        if (event.pointerType === 'mouse') replay()
      }}
      onClick={onClick}
      className="absolute bottom-24 right-4 lg:bottom-4 z-30 h-14 w-14 inline-flex items-center justify-center rounded-full shadow-[0_10px_24px_-10px_rgba(10,46,82,0.7)] btn-press touch-target transition-transform hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-nexgen-blue-dark"
    >
      <NexMark variant="disc" size={LAUNCHER_PX} playToken={plays} />
    </button>
  )
}
