import { useCallback } from 'react'
import { AlertTriangle, Keyboard, Mic, RotateCcw } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { Callout } from '@/components/ui/Callout'
import type { VoiceSessionApi } from '@/hooks/useVoiceSession'
import type { VoiceError } from '@/lib/voice/voiceErrors'
import { TranscriptList } from './TranscriptList'
import { VoiceSheetFooter } from './VoiceSheetFooter'
import { VoiceStatusPill } from './VoiceStatusPill'
import { ERROR_TITLES, canTypeInstead, formatElapsed, isRetryable, minutesToday, voiceStatus } from './voiceStatus'

// Nex Assistant's sheet. PRESENTATIONAL: everything shown comes from the session
// it is handed (useVoiceSession, owned by the launcher) and every control is a
// call on it. Full height on a phone, where reps use it. A backdrop tap does not
// close it (a stray tap must not end a conversation); the X and Escape end the
// session and close.

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

  return (
    <Callout
      tone="danger"
      className="shrink-0"
      icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}
      title={ERROR_TITLES[error.kind]}
      action={actions}
    >
      {error.message}
    </Callout>
  )
}

export function VoiceAssistantSheet({ open, session, onClose }: VoiceAssistantSheetProps) {
  const { end } = session
  const dismiss = useCallback(() => {
    void end('user')
    onClose()
  }, [end, onClose])

  const status = voiceStatus(session.phase, session.live, session.error)

  return (
    <Sheet
      open={open}
      onClose={dismiss}
      title="Nex Assistant"
      icon={<Mic className="w-4 h-4 text-nexgen-blue" aria-hidden="true" />}
      mobile="full"
      width="md"
      dismissOnBackdrop={false}
      bodyClassName="flex-1 min-h-0 flex flex-col gap-3 px-4 py-4 sm:px-6"
      footer={<VoiceSheetFooter session={session} />}
    >
      <VoiceStatusPill status={status} elapsed={formatElapsed(session.elapsedSec)} today={minutesToday(session.budget, session.elapsedSec)} />
      {session.phase === 'error' && session.error && <ErrorCallout session={session} error={session.error} />}
      <TranscriptList entries={session.transcript} />
      {/* The model's voice arrives as a WebRTC track and plays here. Its captions
          are the transcript above (role="log"); a <track> cannot caption a live stream. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={session.audioRef} autoPlay playsInline aria-label="Nex Assistant voice" className="hidden" />
    </Sheet>
  )
}
