import { useCallback, useState } from 'react'
import { AlertTriangle, Keyboard, RotateCcw } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { Callout } from '@/components/ui/Callout'
import type { VoiceSessionApi } from '@/hooks/useVoiceSession'
import type { VoiceError } from '@/lib/voice/voiceErrors'
import { NexOrb } from './NexOrb'
import { orbVisual } from './orbState'
import { TranscriptList } from './TranscriptList'
import { VoiceSheetFooter } from './VoiceSheetFooter'
import { VoiceStatusPill } from './VoiceStatusPill'
import { ERROR_TITLES, canTypeInstead, formatElapsed, isRetryable, minutesToday, voiceStatus } from './voiceStatus'

// Nex's sheet. PRESENTATIONAL: everything shown comes from the session
// it is handed (useVoiceSession, owned by the launcher) and every control is a
// call on it. Full height on a phone, where reps use it. A backdrop tap does not
// close it (a stray tap must not end a conversation); the X and Escape end the
// session and close.
//
// Nex's orb sits above the status pill and is the only orb that animates during a
// chat; the one in the header is an icon that plays a short burst when the sheet
// opens or it is tapped.

/** The hero orb's CSS size; small enough to leave the RS35's 664 px a transcript. */
const HERO_ORB_PX = 120
const HEADER_ORB_PX = 20

export interface VoiceAssistantSheetProps {
  open: boolean
  session: VoiceSessionApi
  onClose: () => void
}

function ErrorCallout({ session, error }: { session: VoiceSessionApi; error: VoiceError }) {
  const retry = isRetryable(error.kind)
  const typeInstead = canTypeInstead(error.kind)
  const actions =
    retry || typeInstead ? (
      <>
        {retry && (
          <Button
            size="sm"
            variant="secondary"
            icon={<RotateCcw className="w-4 h-4" aria-hidden="true" />}
            onClick={() => void session.start({ textOnly: session.textOnly })}
          >
            Retry
          </Button>
        )}
        {typeInstead && (
          <Button
            size="sm"
            variant="primary"
            icon={<Keyboard className="w-4 h-4" aria-hidden="true" />}
            onClick={() => void session.start({ textOnly: true })}
          >
            Type instead
          </Button>
        )}
      </>
    ) : undefined

  // role="alert": the instruction ("Allow the mic for this site...") is the thing
  // a screen-reader user most needs to hear, and it arrives without a focus move.
  return (
    <div role="alert" className="shrink-0">
      <Callout
        tone="danger"
        icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}
        title={ERROR_TITLES[error.kind]}
        action={actions}
      >
        {error.message}
      </Callout>
    </div>
  )
}

export function VoiceAssistantSheet({ open, session, onClose }: VoiceAssistantSheetProps) {
  const { end } = session
  const dismiss = useCallback(() => {
    void end('user')
    onClose()
  }, [end, onClose])

  const status = voiceStatus(session.phase, session.live, session.error, session.textOnly)
  const visual = orbVisual(session.phase, session.live, session.error, session.textOnly)
  const [headerPlays, setHeaderPlays] = useState(0)
  const headerOrb = (
    <span className="inline-flex" onPointerDown={() => setHeaderPlays((n: number) => n + 1)}>
      <NexOrb visual={visual} size={HEADER_ORB_PX} animate="burst" playToken={headerPlays} playOnMount />
    </span>
  )

  return (
    <Sheet
      open={open}
      onClose={dismiss}
      title="Nex"
      icon={headerOrb}
      mobile="full"
      width="md"
      dismissOnBackdrop={false}
      bodyClassName="flex-1 min-h-0 flex flex-col gap-3 px-4 py-4 sm:px-6"
      footer={<VoiceSheetFooter session={session} />}
    >
      <div className="shrink-0 flex justify-center">
        <NexOrb visual={visual} size={HERO_ORB_PX} animate="live" getLevel={session.getLevel} />
      </div>
      <VoiceStatusPill status={status} elapsed={formatElapsed(session.elapsedSec)} today={minutesToday(session.budget, session.elapsedSec)} />
      {session.phase === 'error' && session.error && <ErrorCallout session={session} error={session.error} />}
      <TranscriptList entries={session.transcript} />
      {/* The model's voice arrives as a WebRTC track and plays here. Its captions
          are the transcript above (role="log"); a <track> cannot caption a live stream. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={session.audioRef} autoPlay playsInline hidden aria-label="Nex's voice" />
    </Sheet>
  )
}
