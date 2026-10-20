// The session state machine, with the service mocked, the mic stubbed and a fake
// RealtimeClient injected. Events are scripted onto the fake's onEvent exactly as
// the real client would deliver them (already parsed).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

const { startVoiceSession, endVoiceSession, reportError } = vi.hoisted(() => ({
  startVoiceSession: vi.fn(),
  endVoiceSession: vi.fn(),
  reportError: vi.fn(),
}))
vi.mock('@/lib/errorReporter', () => ({ reportError, installGlobalErrorHandlers: vi.fn() }))
vi.mock('@/services/supabase/voiceSessionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/supabase/voiceSessionService')>()),
  startVoiceSession,
  endVoiceSession,
}))

import { useVoiceSession } from '@/hooks/useVoiceSession'
import type { UseVoiceSessionOptions } from '@/hooks/useVoiceSession'
import { VoiceSessionError } from '@/services/supabase/voiceSessionService'
import { RealtimeConnectError } from '@/lib/voice/realtimeClient'
import type { RealtimeConnectOptions } from '@/lib/voice/realtimeClient'
import { functionOutputItem, parseServerEvent, responseCreate } from '@/lib/voice/realtimeEvents'

const SESSION_ID = '6f1c1f3e-58a4-4a52-9a43-3d1b0c7b1d11'

function minted(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION_ID,
    clientSecret: 'ek_abc',
    expiresAt: 1_800_000_000,
    model: 'gpt-realtime-2.1',
    voice: 'marin',
    maxSeconds: 900,
    budget: { usedSeconds: 120, dailySeconds: 1800 },
    ...overrides,
  }
}

class FakeClient {
  opts: RealtimeConnectOptions | null = null
  connect = vi.fn(async (opts: RealtimeConnectOptions) => {
    this.opts = opts
  })
  send = vi.fn((_event: unknown) => true)
  setMuted = vi.fn()
  close = vi.fn()

  emit(raw: unknown): void {
    const event = parseServerEvent(raw)
    if (!event) throw new Error(`test scripted an event the parser drops: ${JSON.stringify(raw)}`)
    act(() => this.opts!.onEvent(event))
  }

  sent(): unknown[] {
    return this.send.mock.calls.map((call) => call[0])
  }
}

function fakeMic() {
  const track = { kind: 'audio', enabled: true, stop: vi.fn() }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream
  return { track, stream }
}

function stubGetUserMedia(impl: () => Promise<MediaStream>) {
  const getUserMedia = vi.fn(impl)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  return getUserMedia
}

function envelope(code: string, message: string, details?: unknown, status = 429): VoiceSessionError {
  return new VoiceSessionError(message, { status, code, details })
}

const TOOL_RESULT = { ok: true as const, basis: 'Your orders, today', asOf: '2026-10-20T00:00:00.000Z', data: { orders: 3 } }

function renderSession(extra: Partial<UseVoiceSessionOptions> = {}) {
  const runTool = vi.fn((_name: string, _args: unknown) => TOOL_RESULT)
  const onWarning = vi.fn()
  const clients: FakeClient[] = []
  const createClient = () => {
    const client = new FakeClient()
    clients.push(client)
    return client
  }
  const hook = renderHook(() => useVoiceSession({ runTool, onWarning, createClient, ...extra }))
  const client = (): FakeClient => clients[clients.length - 1]
  return { ...hook, runTool, onWarning, clients, client }
}

type Rendered = ReturnType<typeof renderSession>

async function start(r: Rendered, opts?: { textOnly?: boolean }): Promise<void> {
  await act(async () => {
    await r.result.current.start(opts)
  })
}

async function startLive(r: Rendered, opts?: { textOnly?: boolean }): Promise<void> {
  await start(r, opts)
  r.client().emit({ type: 'session.created', session: { id: 'sess_1' } })
}

let mic: ReturnType<typeof fakeMic>
let getUserMedia: ReturnType<typeof stubGetUserMedia>
let visibility: 'visible' | 'hidden' = 'visible'

beforeEach(() => {
  vi.useFakeTimers()
  startVoiceSession.mockReset()
  endVoiceSession.mockReset()
  reportError.mockReset()
  startVoiceSession.mockResolvedValue(minted())
  endVoiceSession.mockResolvedValue(undefined)
  mic = fakeMic()
  getUserMedia = stubGetUserMedia(async () => mic.stream)
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useVoiceSession', () => {
  it('answers a function call with its output then asks for a response', async () => {
    const r = renderSession()
    await startLive(r)
    const client = r.client()
    client.send.mockClear()

    const done = {
      type: 'response.done',
      response: {
        output: [{ type: 'function_call', call_id: 'call_1', name: 'get_sales_summary', arguments: '{"period":"today"}' }],
      },
    }
    client.emit(done)
    client.emit(done)

    expect(r.runTool).toHaveBeenCalledTimes(1)
    expect(r.runTool).toHaveBeenCalledWith('get_sales_summary', { period: 'today' })
    expect(client.sent()).toEqual([functionOutputItem('call_1', JSON.stringify(TOOL_RESULT)), responseCreate()])
  })

  it('reports a spent daily budget as a budget error', async () => {
    const message = "You've used today's 30 minutes of assistant time."
    startVoiceSession.mockRejectedValue(envelope('TOO_MANY_REQUESTS', message, { code: 'DAILY_BUDGET', resetAt: '2026-10-21T00:00:00Z' }))
    const r = renderSession()
    await start(r)

    expect(r.result.current.phase).toBe('error')
    expect(r.result.current.error).toEqual({ kind: 'budget', message })
    expect(r.clients).toHaveLength(0)
    expect(mic.track.stop).toHaveBeenCalled()
  })

  it('answers bad tool arguments without running the tool', async () => {
    const r = renderSession()
    await startLive(r)
    r.client().send.mockClear()
    r.client().emit({
      type: 'response.done',
      response: { output: [{ type: 'function_call', call_id: 'call_2', name: 'get_sales_summary', arguments: '{oops' }] },
    })
    expect(r.runTool).not.toHaveBeenCalled()
    expect(r.client().sent()).toEqual([
      functionOutputItem('call_2', JSON.stringify({ ok: false, error: 'Bad arguments' })),
      responseCreate(),
    ])
  })

  it('maps a blocked mic to mic-denied and never mints', async () => {
    getUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
    const r = renderSession()
    await start(r)
    expect(r.result.current.phase).toBe('error')
    expect(r.result.current.error).toEqual({
      kind: 'mic-denied',
      message: 'Microphone access was blocked. Allow the mic for this site and try again.',
    })
    expect(startVoiceSession).not.toHaveBeenCalled()
  })

  it('maps a missing mic to no-mic', async () => {
    getUserMedia.mockRejectedValue(new DOMException('Requested device not found', 'NotFoundError'))
    const r = renderSession()
    await start(r)
    expect(r.result.current.error?.kind).toBe('no-mic')
    expect(startVoiceSession).not.toHaveBeenCalled()
  })

  it('maps a browser with no mediaDevices to no-mic', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    const r = renderSession()
    await start(r)
    expect(r.result.current.error?.kind).toBe('no-mic')
  })

  it('is offline before it asks for anything', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const r = renderSession()
    await start(r)
    expect(r.result.current.error?.kind).toBe('offline')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(startVoiceSession).not.toHaveBeenCalled()
  })

  it('requests the mic before minting the key', async () => {
    const r = renderSession()
    await start(r)
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true } })
    expect(getUserMedia.mock.invocationCallOrder[0]).toBeLessThan(startVoiceSession.mock.invocationCallOrder[0])
  })

  it('maps other TOO_MANY_REQUESTS to rate-limited', async () => {
    startVoiceSession.mockRejectedValue(envelope('TOO_MANY_REQUESTS', 'Too many sessions started; try again in 60s'))
    const r = renderSession()
    await start(r)
    expect(r.result.current.error).toEqual({ kind: 'rate-limited', message: 'Too many sessions started; try again in 60s' })
  })

  it('maps FORBIDDEN with a module to module-off, and plain FORBIDDEN to forbidden', async () => {
    startVoiceSession.mockRejectedValueOnce(
      envelope('FORBIDDEN', 'The voice assistant module is not enabled for this deployment.', { module: 'voice_assistant' }, 403),
    )
    const r = renderSession()
    await start(r)
    expect(r.result.current.error?.kind).toBe('module-off')

    startVoiceSession.mockRejectedValueOnce(envelope('FORBIDDEN', 'Insufficient role', undefined, 403))
    await start(r)
    expect(r.result.current.error).toEqual({ kind: 'forbidden', message: 'Insufficient role' })
  })

  it('maps any other start failure to upstream', async () => {
    startVoiceSession.mockRejectedValue(envelope('INTERNAL', 'Voice service unavailable', undefined, 500))
    const r = renderSession()
    await start(r)
    expect(r.result.current.error).toEqual({ kind: 'upstream', message: 'Voice service unavailable' })
  })

  it('re-mints once on a 401 from the SDP POST, then reports expired', async () => {
    startVoiceSession
      .mockResolvedValueOnce(minted({ sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', clientSecret: 'ek_one' }))
      .mockResolvedValueOnce(minted({ sessionId: 'aaaaaaaa-0000-4000-8000-000000000002', clientSecret: 'ek_two' }))
    const r = renderSession({
      createClient: () => {
        const client = new FakeClient()
        client.connect.mockRejectedValue(new RealtimeConnectError('expired'))
        return client
      },
    })
    await start(r)

    expect(startVoiceSession).toHaveBeenCalledTimes(2)
    expect(r.result.current.phase).toBe('error')
    expect(r.result.current.error?.kind).toBe('expired')
    const endedIds = endVoiceSession.mock.calls.map((call) => (call[0] as { sessionId: string }).sessionId)
    expect(endedIds).toEqual(['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'])
    expect(endVoiceSession.mock.calls.every((call) => (call[0] as { reason: string }).reason === 'error')).toBe(true)
  })

  it('a re-mint that connects goes on to live', async () => {
    let attempt = 0
    const r = renderSession({
      createClient: () => {
        const client = new FakeClient()
        attempt += 1
        if (attempt === 1) client.connect.mockRejectedValue(new RealtimeConnectError('expired'))
        r.clients.push(client)
        return client
      },
    })
    await startLive(r)
    expect(startVoiceSession).toHaveBeenCalledTimes(2)
    expect(r.result.current.phase).toBe('live')
  })

  it('reports connect-failed without re-minting', async () => {
    const r = renderSession({
      createClient: () => {
        const client = new FakeClient()
        client.connect.mockRejectedValue(new RealtimeConnectError('connect-failed'))
        return client
      },
    })
    await start(r)
    expect(startVoiceSession).toHaveBeenCalledTimes(1)
    expect(r.result.current.error?.kind).toBe('connect-failed')
  })

  it('goes live on session.created with the budget and cap', async () => {
    const r = renderSession()
    expect(r.result.current.phase).toBe('idle')
    await start(r)
    expect(r.result.current.phase).toBe('connecting')
    const opts = r.client().connect.mock.calls[0][0]
    expect(opts.clientSecret).toBe('ek_abc')
    expect(opts.micStream).toBe(mic.stream)

    r.client().emit({ type: 'session.created', session: { id: 'sess_1' } })
    expect(r.result.current.phase).toBe('live')
    expect(r.result.current.live).toBe('listening')
    expect(r.result.current.budget).toEqual({ usedSeconds: 120, dailySeconds: 1800 })
    expect(r.result.current.maxSeconds).toBe(900)
    expect(r.result.current.error).toBeNull()
    expect(r.result.current.textOnly).toBe(false)
  })

  it('starts text-only without the mic and with a receive-only connection', async () => {
    const r = renderSession()
    await startLive(r, { textOnly: true })
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(r.client().connect.mock.calls[0][0].micStream).toBeNull()
    expect(r.result.current.phase).toBe('live')
    expect(r.result.current.textOnly).toBe(true)

    act(() => r.result.current.toggleMute())
    expect(r.result.current.muted).toBe(false)
    expect(r.client().setMuted).not.toHaveBeenCalled()
  })

  it('toggles mute on the client', async () => {
    const r = renderSession()
    await startLive(r)
    act(() => r.result.current.toggleMute())
    expect(r.result.current.muted).toBe(true)
    expect(r.client().setMuted).toHaveBeenLastCalledWith(true)
    act(() => r.result.current.toggleMute())
    expect(r.result.current.muted).toBe(false)
    expect(r.client().setMuted).toHaveBeenLastCalledWith(false)
  })

  it('sendText sends the typed text then asks for a response, and shows it', async () => {
    const r = renderSession()
    await startLive(r, { textOnly: true })
    r.client().send.mockClear()

    act(() => r.result.current.sendText('   '))
    expect(r.client().send).not.toHaveBeenCalled()

    act(() => r.result.current.sendText('  how am I doing today?  '))
    const [item, create] = r.client().sent() as Array<{ type: string; item?: { id?: string; role: string; content: Array<{ type: string; text: string }> } }>
    expect(item.type).toBe('conversation.item.create')
    expect(item.item?.role).toBe('user')
    expect(item.item?.content).toEqual([{ type: 'input_text', text: 'how am I doing today?' }])
    expect(create).toEqual(responseCreate())

    const last = r.result.current.transcript[r.result.current.transcript.length - 1]
    expect(last).toEqual({ id: item.item?.id, role: 'user', text: 'how am I doing today?', final: true })

    // The server echoes the item under the same id: still one line.
    r.client().emit({
      type: 'conversation.item.added',
      item: { id: item.item?.id, type: 'message', role: 'user', content: [{ type: 'input_text', text: 'how am I doing today?' }] },
    })
    expect(r.result.current.transcript.filter((e) => e.role === 'user')).toHaveLength(1)
  })

  it('ends at maxSeconds with reason cap, warning a minute before', async () => {
    startVoiceSession.mockResolvedValue(minted({ maxSeconds: 120 }))
    const r = renderSession()
    await startLive(r)

    act(() => vi.advanceTimersByTime(59_000))
    expect(r.onWarning).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1_000))
    expect(r.onWarning).toHaveBeenCalledWith('One minute of assistant time left')

    act(() => vi.advanceTimersByTime(60_000))
    expect(r.result.current.phase).toBe('ended')
    expect(endVoiceSession).toHaveBeenCalledTimes(1)
    expect(endVoiceSession.mock.calls[0][0]).toMatchObject({ sessionId: SESSION_ID, reason: 'cap' })
  })

  it('ends after two minutes of silence, and speech resets the watchdog', async () => {
    const r = renderSession()
    await startLive(r)
    act(() => vi.advanceTimersByTime(100_000))
    r.client().emit({ type: 'input_audio_buffer.speech_started', item_id: 'item_1' })
    act(() => vi.advanceTimersByTime(100_000))
    expect(r.result.current.phase).toBe('live')

    act(() => vi.advanceTimersByTime(20_000))
    expect(r.result.current.phase).toBe('ended')
    expect(endVoiceSession.mock.calls[0][0]).toMatchObject({ reason: 'silence' })
  })

  it('ends when the tab stays hidden for a minute, with keepalive', async () => {
    const r = renderSession()
    await startLive(r)

    visibility = 'hidden'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    act(() => vi.advanceTimersByTime(30_000))
    visibility = 'visible'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    // 30 s hidden + 40 s visible: past the first hide's minute, inside the silence watchdog.
    act(() => vi.advanceTimersByTime(40_000))
    expect(r.result.current.phase).toBe('live')
    r.client().emit({ type: 'input_audio_buffer.speech_started', item_id: 'item_1' })

    visibility = 'hidden'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    act(() => vi.advanceTimersByTime(60_000))
    expect(r.result.current.phase).toBe('ended')
    expect(endVoiceSession).toHaveBeenCalledWith(expect.objectContaining({ reason: 'hidden' }), { keepalive: true })
  })

  it('ends with reason channel when the data channel closes', async () => {
    const r = renderSession()
    await startLive(r)
    act(() => r.client().opts!.onClose())
    expect(r.result.current.phase).toBe('ended')
    expect(endVoiceSession).toHaveBeenCalledWith(expect.objectContaining({ reason: 'channel' }), { keepalive: false })
  })

  it('end() is idempotent and stops every mic track', async () => {
    const r = renderSession()
    await startLive(r)
    await act(async () => {
      await r.result.current.end()
      await r.result.current.end()
    })
    expect(r.result.current.phase).toBe('ended')
    expect(r.client().close).toHaveBeenCalledTimes(1)
    expect(mic.track.stop).toHaveBeenCalled()
    expect(endVoiceSession).toHaveBeenCalledTimes(1)
    expect(endVoiceSession.mock.calls[0]).toEqual([
      expect.objectContaining({ sessionId: SESSION_ID, reason: 'user' }),
      { keepalive: false },
    ])

    // No timer survives the end.
    act(() => vi.advanceTimersByTime(20 * 60_000))
    expect(endVoiceSession).toHaveBeenCalledTimes(1)
  })

  it('reports the usage accumulated from response.done', async () => {
    const r = renderSession()
    await startLive(r)
    const usage = {
      input_tokens: 100,
      output_tokens: 50,
      input_token_details: { audio_tokens: 80, text_tokens: 20, cached_tokens: 10 },
      output_token_details: { audio_tokens: 40, text_tokens: 10 },
    }
    r.client().emit({ type: 'response.done', response: { output: [], usage } })
    r.client().emit({ type: 'response.done', response: { output: [], usage } })
    await act(async () => {
      await r.result.current.end()
    })
    expect(endVoiceSession.mock.calls[0][0]).toEqual({
      sessionId: SESSION_ID,
      reason: 'user',
      usage: {
        inputTokens: 200,
        outputTokens: 100,
        inputAudioTokens: 160,
        inputTextTokens: 40,
        cachedInputTokens: 20,
        outputAudioTokens: 80,
        outputTextTokens: 20,
      },
    })
  })

  it('ends the session on unmount, with keepalive', async () => {
    const r = renderSession()
    await startLive(r)
    r.unmount()
    expect(endVoiceSession).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unmount' }), { keepalive: true })
    expect(mic.track.stop).toHaveBeenCalled()
  })

  it('counts elapsed seconds while live', async () => {
    const r = renderSession()
    await startLive(r)
    act(() => vi.advanceTimersByTime(3_000))
    expect(r.result.current.elapsedSec).toBe(3)
  })

  it('reports a failed end to the error reporter, not to the user', async () => {
    endVoiceSession.mockRejectedValue(new Error('network'))
    const r = renderSession()
    await startLive(r)
    await act(async () => {
      await r.result.current.end()
    })
    expect(r.result.current.phase).toBe('ended')
    expect(r.result.current.error).toBeNull()
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(reportError.mock.calls)).not.toContain('ek_abc')
  })

  it('fails as connect-failed when session.created does not arrive within 20 s', async () => {
    const r = renderSession()
    await start(r)
    expect(r.result.current.phase).toBe('connecting')
    act(() => vi.advanceTimersByTime(19_999))
    expect(r.result.current.phase).toBe('connecting')
    act(() => vi.advanceTimersByTime(1))

    expect(r.result.current.phase).toBe('error')
    expect(r.result.current.error?.kind).toBe('connect-failed')
    expect(mic.track.stop).toHaveBeenCalled()
    expect(r.client().close).toHaveBeenCalledTimes(1)
    expect(endVoiceSession).toHaveBeenCalledTimes(1)
    expect(endVoiceSession.mock.calls[0][0]).toMatchObject({ sessionId: SESSION_ID, reason: 'error' })
  })

  it('session.created before 20 s clears the connect timeout', async () => {
    const r = renderSession()
    await start(r)
    act(() => vi.advanceTimersByTime(10_000))
    r.client().emit({ type: 'session.created', session: { id: 'sess_1' } })
    act(() => vi.advanceTimersByTime(15_000))
    expect(r.result.current.phase).toBe('live')
    expect(r.result.current.error).toBeNull()
    expect(endVoiceSession).not.toHaveBeenCalled()
  })

  it('a dead connection reported twice (peer failed, then channel closed) ends the session once', async () => {
    const r = renderSession()
    await startLive(r)
    act(() => {
      r.client().opts!.onClose()
      r.client().opts!.onClose()
    })
    expect(r.result.current.phase).toBe('ended')
    expect(endVoiceSession).toHaveBeenCalledTimes(1)
    expect(endVoiceSession.mock.calls[0][0]).toMatchObject({ reason: 'channel' })
  })

  it('counts the usage of a response delivered twice once', async () => {
    const r = renderSession()
    await startLive(r)
    const done = { type: 'response.done', response: { id: 'resp_1', output: [], usage: { input_tokens: 10, output_tokens: 4 } } }
    r.client().emit(done)
    r.client().emit(done)
    r.client().emit({ type: 'response.done', response: { output: [], usage: { input_tokens: 1, output_tokens: 1 } } })
    await act(async () => {
      await r.result.current.end()
    })
    expect(endVoiceSession.mock.calls[0][0]).toMatchObject({ usage: expect.objectContaining({ inputTokens: 11, outputTokens: 5 }) })
  })

  function deferredMint() {
    let resolve: (value: ReturnType<typeof minted>) => void = () => undefined
    startVoiceSession.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    return (value: ReturnType<typeof minted>) => resolve(value)
  }

  it('end() while the key is being minted closes the late session with reason user and never connects', async () => {
    const resolveMint = deferredMint()
    const r = renderSession()
    let starting: Promise<void> = Promise.resolve()
    await act(async () => {
      starting = r.result.current.start()
      await Promise.resolve()
    })
    expect(r.result.current.phase).toBe('minting')
    await act(async () => {
      await r.result.current.end()
    })
    expect(mic.track.stop).toHaveBeenCalled()
    await act(async () => {
      resolveMint(minted({ sessionId: 'bbbbbbbb-0000-4000-8000-000000000009' }))
      await starting
    })
    expect(r.clients).toHaveLength(0)
    expect(r.result.current.phase).toBe('ended')
    expect(endVoiceSession).toHaveBeenCalledTimes(1)
    expect(endVoiceSession.mock.calls[0]).toEqual([
      expect.objectContaining({ sessionId: 'bbbbbbbb-0000-4000-8000-000000000009', reason: 'user' }),
      { keepalive: false },
    ])
  })

  it('unmount while the key is being minted closes the late session with reason unmount', async () => {
    const resolveMint = deferredMint()
    const r = renderSession()
    let starting: Promise<void> = Promise.resolve()
    await act(async () => {
      starting = r.result.current.start()
      await Promise.resolve()
    })
    r.unmount()
    expect(mic.track.stop).toHaveBeenCalled()
    await act(async () => {
      resolveMint(minted({ sessionId: 'bbbbbbbb-0000-4000-8000-00000000000a' }))
      await starting
    })
    expect(r.clients).toHaveLength(0)
    expect(endVoiceSession).toHaveBeenCalledTimes(1)
    expect(endVoiceSession.mock.calls[0]).toEqual([
      expect.objectContaining({ sessionId: 'bbbbbbbb-0000-4000-8000-00000000000a', reason: 'unmount' }),
      { keepalive: true },
    ])
  })

  it('reports a tool answer the closed channel could not take', async () => {
    const r = renderSession()
    await startLive(r)
    r.client().send.mockReturnValue(false)
    r.client().emit({
      type: 'response.done',
      response: { output: [{ type: 'function_call', call_id: 'call_9', name: 'get_sales_summary', arguments: '{}' }] },
    })
    expect(reportError).toHaveBeenCalledTimes(2)
    const metadata = reportError.mock.calls.map((call) => (call[0] as { metadata: Record<string, unknown> }).metadata)
    expect(metadata).toEqual([
      expect.objectContaining({ event: 'function_call_output', callId: 'call_9' }),
      expect.objectContaining({ event: 'response.create' }),
    ])
    expect(JSON.stringify(reportError.mock.calls)).not.toContain('ek_abc')
    expect(r.result.current.phase).toBe('live')
  })
})
