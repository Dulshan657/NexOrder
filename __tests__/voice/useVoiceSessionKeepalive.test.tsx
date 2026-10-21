// The page-close end must leave in the SAME TICK as the event.
//
// On pagehide the page may be gone before any promise settles, so the keepalive
// POST cannot wait for supabase.auth.getSession(). The hook caches the user's
// access token when a session starts and refreshes it while live (each five
// minutes and at the one-minute cap warning, never on unload), and hands it to
// endVoiceSession, which then issues fetch(..., { keepalive: true }) before its
// first await (voiceSessionService.test.ts proves that half). Without a cached
// token it falls back to the awaited path.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

const { startVoiceSession, endVoiceSession, readAccessToken, reportError } = vi.hoisted(() => ({
  startVoiceSession: vi.fn(),
  endVoiceSession: vi.fn(),
  readAccessToken: vi.fn(),
  reportError: vi.fn(),
}))
vi.mock('@/lib/errorReporter', () => ({ reportError, installGlobalErrorHandlers: vi.fn() }))
vi.mock('@/services/supabase/voiceSessionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/supabase/voiceSessionService')>()),
  startVoiceSession,
  endVoiceSession,
  readAccessToken,
}))

import { useVoiceSession } from '@/hooks/useVoiceSession'
import type { RealtimeConnectOptions } from '@/lib/voice/realtimeClient'
import { parseServerEvent } from '@/lib/voice/realtimeEvents'

const SESSION_ID = '6f1c1f3e-58a4-4a52-9a43-3d1b0c7b1d11'
const TOKEN = 'cached-token-1'
const FIVE_MINUTES_MS = 5 * 60_000

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
    if (!event) throw new Error(`unparseable test event: ${JSON.stringify(raw)}`)
    act(() => this.opts!.onEvent(event))
  }
}

function minted(maxSeconds = 900) {
  return {
    sessionId: SESSION_ID, clientSecret: 'ek_abc', expiresAt: 1_800_000_000, model: 'gpt-realtime-2.1',
    voice: 'marin', maxSeconds, budget: { usedSeconds: 0, dailySeconds: 1800 },
  }
}

async function startLive() {
  const clients: FakeClient[] = []
  const createClient = () => {
    const client = new FakeClient()
    clients.push(client)
    return client
  }
  const hook = renderHook(() => useVoiceSession({ runTool: vi.fn(), onWarning: vi.fn(), createClient }))
  await act(async () => {
    await hook.result.current.start({ textOnly: true })
  })
  clients[0].emit({ type: 'session.created', session: { id: 'sess_1' } })
  return { ...hook, client: clients[0] }
}

/** Advance `ms` in one-minute steps with a response each step, so the two-minute silence watchdog never fires. */
function talkFor(client: FakeClient, ms: number): void {
  for (let left = ms; left > 0; left -= 60_000) {
    client.emit({ type: 'response.created', response: { id: `resp_${left}` } })
    act(() => vi.advanceTimersByTime(Math.min(60_000, left)))
  }
}

/** Let settled promises run their callbacks (fake timers do not fake microtasks). */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

let visibility: 'visible' | 'hidden' = 'visible'

beforeEach(() => {
  vi.useFakeTimers()
  for (const mock of [startVoiceSession, endVoiceSession, readAccessToken, reportError]) mock.mockReset()
  startVoiceSession.mockResolvedValue(minted())
  endVoiceSession.mockResolvedValue(undefined)
  readAccessToken.mockResolvedValue(TOKEN)
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useVoiceSession page-close end', () => {
  it('reads the access token once, when the session starts', async () => {
    await startLive()
    expect(readAccessToken).toHaveBeenCalledTimes(1)
  })

  it('pagehide hands endVoiceSession the cached token in the same tick, without reading the session again', async () => {
    const r = await startLive()
    readAccessToken.mockClear()
    // act() is synchronous: there is still no await between the event and these assertions.
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(endVoiceSession).toHaveBeenCalledTimes(1)
    expect(endVoiceSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, reason: 'hidden' }),
      { keepalive: true, accessToken: TOKEN },
    )
    expect(readAccessToken).not.toHaveBeenCalled()
    expect(r.result.current.phase).toBe('ended')
  })

  it('beforeunload does the same', async () => {
    await startLive()
    window.dispatchEvent(new Event('beforeunload'))
    expect(endVoiceSession).toHaveBeenCalledWith(expect.objectContaining({ reason: 'hidden' }), { keepalive: true, accessToken: TOKEN })
  })

  it('unmount hands over the cached token in the same tick', async () => {
    const r = await startLive()
    readAccessToken.mockClear()
    r.unmount()
    expect(endVoiceSession).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unmount' }), { keepalive: true, accessToken: TOKEN })
    expect(readAccessToken).not.toHaveBeenCalled()
  })

  it('a tab hidden for a minute hands over the cached token', async () => {
    await startLive()
    visibility = 'hidden'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    act(() => vi.advanceTimersByTime(60_000))
    expect(endVoiceSession).toHaveBeenCalledWith(expect.objectContaining({ reason: 'hidden' }), { keepalive: true, accessToken: TOKEN })
  })

  it('refreshes the cached token every five minutes while live', async () => {
    const r = await startLive()
    readAccessToken.mockResolvedValue('cached-token-2')
    talkFor(r.client, FIVE_MINUTES_MS)
    await flush()
    expect(readAccessToken).toHaveBeenCalledTimes(2)
    r.unmount()
    expect(endVoiceSession).toHaveBeenCalledWith(expect.anything(), { keepalive: true, accessToken: 'cached-token-2' })
  })

  it('refreshes the cached token at the one-minute cap warning', async () => {
    startVoiceSession.mockResolvedValue(minted(120))
    const r = await startLive()
    readAccessToken.mockResolvedValue('cached-token-3')
    act(() => vi.advanceTimersByTime(60_000))
    await flush()
    r.unmount()
    expect(endVoiceSession).toHaveBeenCalledWith(expect.anything(), { keepalive: true, accessToken: 'cached-token-3' })
  })

  it('keeps the last token when a refresh finds none', async () => {
    const r = await startLive()
    readAccessToken.mockResolvedValue(null)
    talkFor(r.client, FIVE_MINUTES_MS)
    await flush()
    r.unmount()
    expect(endVoiceSession).toHaveBeenCalledWith(expect.anything(), { keepalive: true, accessToken: TOKEN })
  })

  it('falls back to the awaited path when no token was cached', async () => {
    readAccessToken.mockResolvedValue(null)
    await startLive()
    window.dispatchEvent(new Event('pagehide'))
    expect(endVoiceSession).toHaveBeenCalledWith(expect.objectContaining({ reason: 'hidden' }), { keepalive: true })
  })

  it('does not pass the token on an ordinary end', async () => {
    const r = await startLive()
    await act(async () => {
      await r.result.current.end()
    })
    expect(endVoiceSession).toHaveBeenCalledWith(expect.objectContaining({ reason: 'user' }), { keepalive: false })
  })

  it('never puts the token in an error report', async () => {
    endVoiceSession.mockRejectedValue(new Error('network'))
    await startLive()
    window.dispatchEvent(new Event('pagehide'))
    await flush()
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(reportError.mock.calls)).not.toContain(TOKEN)
  })
})
