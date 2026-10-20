import { useState } from 'react'
import { Mic, MicOff, RotateCcw, Send } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import type { VoiceSessionApi } from '@/hooks/useVoiceSession'
import { isActivePhase } from './voiceStatus'

// The sheet's controls: a typed fallback (Enter sends; only while live), Mute
// (voice sessions only), and End, or Start again once the session is over.

export interface VoiceSheetFooterProps {
  session: VoiceSessionApi
}

// The shared input (components/ui/Field): its solid nexgen-blue-dark focus ring
// passes SC 1.4.11, which a hand-rolled `ring-nexgen-blue/40` (1.62:1) does not.
const INPUT_LAYOUT = 'flex-1 min-w-0 text-stone-900 placeholder:text-stone-500 disabled:bg-stone-50 disabled:text-stone-400'

function TypedInput({ session }: VoiceSheetFooterProps) {
  const [text, setText] = useState('')
  const live = session.phase === 'live'

  const submit = () => {
    const trimmed = text.trim()
    if (!live || trimmed.length === 0) return
    session.sendText(trimmed)
    setText('')
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        aria-label="Type a message"
        placeholder={live ? 'Type a question' : 'Available once connected'}
        value={text}
        disabled={!live}
        onChange={(event: { target: { value: string } }) => setText(event.target.value)}
        onKeyDown={(event: { key: string; nativeEvent?: { isComposing?: boolean }; preventDefault: () => void }) => {
          if (event.key !== 'Enter' || event.nativeEvent?.isComposing) return
          event.preventDefault()
          submit()
        }}
        className={INPUT_LAYOUT}
      />
      <Button variant="secondary" icon={<Send className="w-4 h-4" aria-hidden="true" />} disabled={!live || text.trim().length === 0} onClick={submit}>
        Send
      </Button>
    </div>
  )
}

function MuteButton({ session }: VoiceSheetFooterProps) {
  const { muted } = session
  return (
    <Button
      variant="secondary"
      aria-pressed={muted}
      disabled={session.phase !== 'live'}
      icon={muted ? <MicOff className="w-4 h-4" aria-hidden="true" /> : <Mic className="w-4 h-4" aria-hidden="true" />}
      onClick={() => session.toggleMute()}
    >
      {muted ? 'Unmute' : 'Mute'}
    </Button>
  )
}

export function VoiceSheetFooter({ session }: VoiceSheetFooterProps) {
  const active = isActivePhase(session.phase)
  const ended = session.phase === 'ended'

  return (
    <div className="w-full flex flex-col gap-2">
      <TypedInput session={session} />
      <div className="flex items-center justify-between gap-2">
        {active && !session.textOnly ? <MuteButton session={session} /> : <span />}
        {ended && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-stone-600">Session ended</span>
            <Button
              variant="primary"
              icon={<RotateCcw className="w-4 h-4" aria-hidden="true" />}
              onClick={() => void session.start({ textOnly: session.textOnly })}
            >
              Start again
            </Button>
          </div>
        )}
        {active && (
          <Button variant="danger" onClick={() => void session.end('user')}>
            End
          </Button>
        )}
      </div>
    </div>
  )
}
