// The assistant sheet, rendered against a controlled session object. The sheet is
// presentational: everything it shows comes from the VoiceSessionApi it is handed,
// and everything it does is a call on that same object, so no mic, network or
// RealtimeClient is involved here (those are useVoiceSession's tests).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { VoiceAssistantSheet } from '@/components/voice/VoiceAssistantSheet'
import type { VoiceSessionApi } from '@/hooks/useVoiceSession'
import { voiceError } from '@/lib/voice/voiceErrors'
import type { VoiceErrorKind } from '@/lib/voice/voiceErrors'
import type { TranscriptEntry } from '@/lib/voice/transcript'
import { __resetModalStack } from '@/components/ui/useModalStack'
import { __resetScrollLock } from '@/components/ui/useScrollLock'

const TRANSCRIPT: readonly TranscriptEntry[] = [
  { id: 'u1', role: 'user', text: 'How are my sales this week?', final: true },
  { id: 'a1', role: 'assistant', text: 'You have sold 4,200 dollars this week', final: false },
]

function fakeSession(overrides: Partial<VoiceSessionApi> = {}): VoiceSessionApi {
  return {
    phase: 'live',
    live: 'listening',
    muted: false,
    textOnly: false,
    transcript: TRANSCRIPT,
    error: null,
    budget: { usedSeconds: 120, dailySeconds: 1800 },
    maxSeconds: 900,
    elapsedSec: 65,
    start: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    toggleMute: vi.fn(),
    sendText: vi.fn(),
    audioRef: { current: null },
    getLevel: vi.fn(() => 0),
    ...overrides,
  }
}

function renderSheet(session: VoiceSessionApi, onClose = vi.fn()) {
  return render(<VoiceAssistantSheet open session={session} onClose={onClose} />)
}

const status = () => screen.getByRole('status')

const KINDS: readonly VoiceErrorKind[] = [
  'mic-denied',
  'no-mic',
  'offline',
  'rate-limited',
  'budget',
  'module-off',
  'forbidden',
  'upstream',
  'connect-failed',
  'expired',
]

// jsdom has no canvas; the orbs draw into a context that records nothing.
function stubCanvas() {
  const noop = () => undefined
  const ctx = new Proxy({}, { get: (_t, key) => (key === 'canvas' ? null : noop), set: () => true })
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext
}

const orbs = (animate: string) => Array.from(document.querySelectorAll(`[data-orb-animate="${animate}"]`))

beforeEach(() => {
  stubCanvas()
  __resetModalStack()
  __resetScrollLock()
  const main = document.createElement('div')
  main.setAttribute('data-scroll-container', '')
  document.body.appendChild(main)
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('VoiceAssistantSheet', () => {
  it('mutes the mic and ends the session', () => {
    const toggleMute = vi.fn()
    const end = vi.fn(async () => {})

    // Muted is the session's state, not the sheet's: the harness flips it the way
    // useVoiceSession does, so the label and aria-pressed must follow the prop.
    function Harness() {
      const [muted, setMuted] = useState(false)
      const session = fakeSession({
        muted,
        end,
        toggleMute: () => {
          toggleMute()
          setMuted((m: boolean) => !m)
        },
      })
      return <VoiceAssistantSheet open session={session} onClose={vi.fn()} />
    }
    render(<Harness />)

    const log = screen.getByRole('log')
    expect(within(log).getByText('How are my sales this week?')).toBeTruthy()
    expect(within(log).getByText('You have sold 4,200 dollars this week')).toBeTruthy()

    const mute = screen.getByRole('button', { name: 'Mute' })
    expect(mute.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(mute)
    expect(toggleMute).toHaveBeenCalledTimes(1)
    const unmute = screen.getByRole('button', { name: 'Unmute' })
    expect(unmute.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(unmute)
    expect(toggleMute).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'End' }))
    expect(end).toHaveBeenCalledWith('user')
  })

  it('shows an aria-hidden hero orb that follows the live state', () => {
    const { rerender } = renderSheet(fakeSession({ phase: 'live', live: 'listening' }))
    const [hero] = orbs('live')
    expect(hero).toBeTruthy()
    expect(hero.getAttribute('aria-hidden')).toBe('true')
    expect(hero.getAttribute('data-orb-state')).toBe('listening')
    // Above the status pill: the orb is what the eye lands on, the word explains it.
    expect(hero.compareDocumentPosition(status()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    rerender(<VoiceAssistantSheet open session={fakeSession({ phase: 'live', live: 'thinking' })} onClose={vi.fn()} />)
    expect(orbs('live')[0].getAttribute('data-orb-state')).toBe('working')

    rerender(<VoiceAssistantSheet open session={fakeSession({ phase: 'live', live: 'speaking' })} onClose={vi.fn()} />)
    expect(orbs('live')[0].getAttribute('data-orb-state')).toBe('composing')
  })

  it('shows the Nex mark in the header and keeps the live hero orb', () => {
    renderSheet(fakeSession({ phase: 'live', live: 'speaking' }))
    const dialog = screen.getByRole('dialog', { name: 'Nex' })
    expect(orbs('live')).toHaveLength(1)
    expect(orbs('burst')).toHaveLength(0)
    const marks = Array.from(dialog.querySelectorAll('[data-nex-mark]'))
    expect(marks).toHaveLength(1)
    expect(marks[0].getAttribute('data-nex-mark')).toBe('bare')
    expect(marks[0].getAttribute('aria-hidden')).toBe('true')
  })

  it('calls the assistant Nex in the title and the transcript', () => {
    renderSheet(fakeSession())
    expect(screen.getByRole('dialog', { name: 'Nex' })).toBeTruthy()
    expect(screen.queryByText('Nex Assistant')).toBeNull()
    const log = screen.getByRole('log')
    expect(log.textContent).toContain('Nex: You have sold 4,200 dollars this week')
    expect(log.textContent).not.toContain('Nex Assistant')
  })

  it('is a full-height dialog titled Nex', () => {
    renderSheet(fakeSession())
    const dialog = screen.getByRole('dialog', { name: 'Nex' })
    expect(dialog.className).toContain('ui-sheet-panel--full')
  })

  it.each([
    ['requesting-mic', 'listening', 'Requesting microphone'],
    ['minting', 'listening', 'Connecting'],
    ['connecting', 'listening', 'Connecting'],
    ['live', 'listening', 'Listening'],
    ['live', 'thinking', 'Thinking'],
    ['live', 'speaking', 'Speaking'],
    ['ending', 'listening', 'Ending'],
    ['ended', 'listening', 'Ended'],
  ] as const)('shows the status for phase %s / %s', (phase, live, text) => {
    renderSheet(fakeSession({ phase, live }))
    expect(status().textContent).toContain(text)
    expect(status().getAttribute('aria-live')).toBe('polite')
  })

  it('says Ready, not Listening, in a text-only session (there is no mic)', () => {
    renderSheet(fakeSession({ textOnly: true, phase: 'live', live: 'listening' }))
    expect(status().textContent).toContain('Ready')
    expect(status().textContent).not.toContain('Listening')
    // Neutral, not the emerald "hearing you" dot, and not pulsing.
    expect(status().querySelector('.bg-emerald-500')).toBeNull()
    expect(status().querySelector('.animate-ping')).toBeNull()
  })

  it('still says Thinking and Speaking in a text-only session', () => {
    renderSheet(fakeSession({ textOnly: true, phase: 'live', live: 'thinking' }))
    expect(status().textContent).toContain('Thinking')
    cleanup()
    renderSheet(fakeSession({ textOnly: true, phase: 'live', live: 'speaking' }))
    expect(status().textContent).toContain('Speaking')
  })

  it('shows the elapsed time as m:ss and the minutes used today', () => {
    renderSheet(fakeSession({ elapsedSec: 65, budget: { usedSeconds: 120, dailySeconds: 1800 } }))
    expect(screen.getByText('1:05')).toBeTruthy()
    // 120 s before this session + 65 s of it = 3 whole minutes.
    expect(screen.getByText('3/30 min today')).toBeTruthy()
  })

  it('renders an in-progress line in italics and a final one upright', () => {
    renderSheet(fakeSession())
    const partial = screen.getByText('You have sold 4,200 dollars this week')
    const done = screen.getByText('How are my sales this week?')
    expect(partial.className).toContain('italic')
    expect(done.className).not.toContain('italic')
  })

  it('sends typed text on Enter and clears the box', () => {
    const sendText = vi.fn()
    renderSheet(fakeSession({ sendText }))
    const box = screen.getByRole('textbox', { name: 'Type a message' }) as HTMLInputElement
    fireEvent.change(box, { target: { value: 'Who should I visit today?' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(sendText).toHaveBeenCalledWith('Who should I visit today?')
    expect(box.value).toBe('')
  })

  it('uses the shared input, whose focus ring passes contrast', () => {
    renderSheet(fakeSession())
    const box = screen.getByRole('textbox', { name: 'Type a message' })
    expect(box.className).not.toContain('ring-nexgen-blue/40')
    expect(box.className).toContain('ring-nexgen-blue-dark')
  })

  it('sends typed text with the Send button', () => {
    const sendText = vi.fn()
    renderSheet(fakeSession({ sendText }))
    const box = screen.getByRole('textbox', { name: 'Type a message' })
    fireEvent.change(box, { target: { value: 'Stock of rice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(sendText).toHaveBeenCalledWith('Stock of rice')
  })

  it('does not send blank text', () => {
    const sendText = vi.fn()
    renderSheet(fakeSession({ sendText }))
    const box = screen.getByRole('textbox', { name: 'Type a message' })
    fireEvent.change(box, { target: { value: '   ' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(sendText).not.toHaveBeenCalled()
  })

  it.each(['requesting-mic', 'connecting', 'ended', 'error'] as const)('disables typing while %s', (phase) => {
    const sendText = vi.fn()
    renderSheet(fakeSession({ phase, error: phase === 'error' ? voiceError('upstream') : null, sendText }))
    const box = screen.getByRole('textbox', { name: 'Type a message' }) as HTMLInputElement
    expect(box.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(sendText).not.toHaveBeenCalled()
  })

  it.each(KINDS)('explains a %s error in a callout', (kind) => {
    const error = voiceError(kind)
    renderSheet(fakeSession({ phase: 'error', error }))
    expect(screen.getByText(error.message)).toBeTruthy()
    // The pill names the error rather than a phase.
    expect(status().textContent).not.toContain('Listening')
    expect((status().textContent ?? '').trim().length).toBeGreaterThan(0)
  })

  it.each(KINDS)('announces a %s error as an alert', (kind) => {
    const error = voiceError(kind)
    renderSheet(fakeSession({ phase: 'error', error }))
    expect(screen.getByRole('alert').textContent).toContain(error.message)
  })

  it('tells a rep the module is off in plain words', () => {
    const error = voiceError('module-off')
    expect(error.message).toBe('The assistant is not enabled for your company.')
    renderSheet(fakeSession({ phase: 'error', error }))
    expect(screen.getByText('The assistant is not enabled for your company.')).toBeTruthy()
  })

  it('gives every error kind its own title', () => {
    const titles = new Set<string>()
    for (const kind of KINDS) {
      renderSheet(fakeSession({ phase: 'error', error: voiceError(kind) }))
      titles.add(status().textContent ?? '')
      cleanup()
    }
    expect(titles.size).toBe(KINDS.length)
  })

  it.each(['offline', 'rate-limited', 'upstream', 'connect-failed', 'expired', 'mic-denied', 'no-mic'] as const)(
    'offers Retry for a %s error, keeping the session mode',
    (kind) => {
      const start = vi.fn(async () => {})
      renderSheet(fakeSession({ phase: 'error', error: voiceError(kind), start }))
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(start).toHaveBeenCalledWith({ textOnly: false })
    },
  )

  it('retries a text-only session as text-only', () => {
    const start = vi.fn(async () => {})
    renderSheet(fakeSession({ phase: 'error', textOnly: true, error: voiceError('upstream'), start }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(start).toHaveBeenCalledWith({ textOnly: true })
  })

  it.each(['budget', 'module-off', 'forbidden'] as const)('offers no Retry for a %s error, which retrying cannot fix', (kind) => {
    renderSheet(fakeSession({ phase: 'error', error: voiceError(kind) }))
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it.each(['mic-denied', 'no-mic'] as const)('offers Type instead for a %s error, which starts text-only', (kind) => {
    const start = vi.fn(async () => {})
    renderSheet(fakeSession({ phase: 'error', error: voiceError(kind), start }))
    fireEvent.click(screen.getByRole('button', { name: 'Type instead' }))
    expect(start).toHaveBeenCalledWith({ textOnly: true })
  })

  it.each(['offline', 'upstream', 'budget'] as const)('does not offer Type instead for a %s error', (kind) => {
    renderSheet(fakeSession({ phase: 'error', error: voiceError(kind) }))
    expect(screen.queryByRole('button', { name: 'Type instead' })).toBeNull()
  })

  it('hides Mute in a text-only session', () => {
    renderSheet(fakeSession({ textOnly: true }))
    expect(screen.queryByRole('button', { name: 'Mute' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unmute' })).toBeNull()
    expect(screen.getByRole('button', { name: 'End' })).toBeTruthy()
  })

  it('offers Start again once the session has ended', () => {
    const start = vi.fn(async () => {})
    renderSheet(fakeSession({ phase: 'ended', start }))
    expect(screen.getByText('Session ended')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mute' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    expect(start).toHaveBeenCalledWith({ textOnly: false })
  })

  it('attaches a hidden autoplaying, inline audio element to audioRef', () => {
    const session = fakeSession()
    renderSheet(session)
    const audio = document.querySelector('audio')
    expect(audio).not.toBeNull()
    expect(session.audioRef.current).toBe(audio)
    expect(audio!.hidden).toBe(true)
    expect(audio!.hasAttribute('controls')).toBe(false)
    expect(audio!.autoplay).toBe(true)
    expect(audio!.hasAttribute('playsinline')).toBe(true)
  })

  it('ends the session and closes when dismissed with the X', () => {
    const end = vi.fn(async () => {})
    const onClose = vi.fn()
    renderSheet(fakeSession({ end }), onClose)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(end).toHaveBeenCalledWith('user')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
