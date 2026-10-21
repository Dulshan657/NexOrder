// The two calls the browser makes to the voice-session Edge Function, and how a
// failure's envelope reaches the hook intact.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke, getSession } = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke }, auth: { getSession } },
}))

import { VoiceSessionError, endVoiceSession, readAccessToken, startVoiceSession } from '@/services/supabase/voiceSessionService'

function httpError(status: number, body: unknown): Error {
  const err = new Error('Edge Function returned a non-2xx status code')
  ;(err as Error & { context: Response }).context = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return err
}

const STARTED = {
  ok: true,
  sessionId: '6f1c1f3e-58a4-4a52-9a43-3d1b0c7b1d11',
  clientSecret: 'ek_abc',
  expiresAt: 1_800_000_000,
  model: 'gpt-realtime-2.1',
  voice: 'marin',
  maxSeconds: 900,
  budget: { usedSeconds: 120, dailySeconds: 1800 },
}

const USAGE = {
  inputTokens: 10, outputTokens: 20, inputAudioTokens: 6, inputTextTokens: 4,
  cachedInputTokens: 0, outputAudioTokens: 15, outputTextTokens: 5,
}

beforeEach(() => {
  invoke.mockReset()
  getSession.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('startVoiceSession', () => {
  it('posts action start and returns the session', async () => {
    invoke.mockResolvedValue({ data: STARTED, error: null })
    const started = await startVoiceSession()
    expect(invoke).toHaveBeenCalledWith('voice-session', { body: { action: 'start' } })
    expect(started).toEqual({
      sessionId: STARTED.sessionId,
      clientSecret: 'ek_abc',
      expiresAt: STARTED.expiresAt,
      model: 'gpt-realtime-2.1',
      voice: 'marin',
      maxSeconds: 900,
      budget: { usedSeconds: 120, dailySeconds: 1800 },
    })
  })

  it('carries the envelope code, message and details on the thrown error', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(429, {
        error: { code: 'TOO_MANY_REQUESTS', message: "You've used today's 30 minutes of assistant time.", details: { code: 'DAILY_BUDGET' } },
      }),
    })
    const failure = await startVoiceSession().catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(VoiceSessionError)
    expect(failure).toMatchObject({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      message: "You've used today's 30 minutes of assistant time.",
      details: { code: 'DAILY_BUDGET' },
    })
  })

  it('a failure with no response is an error with no code', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to send a request to the Edge Function') })
    const failure = await startVoiceSession().catch((e: unknown) => e)
    expect(failure).toMatchObject({ code: null, status: null, message: 'Failed to send a request to the Edge Function' })
  })

  it('refuses a response that is not a session', async () => {
    invoke.mockResolvedValue({ data: { ok: true, sessionId: 'x' }, error: null })
    await expect(startVoiceSession()).rejects.toBeInstanceOf(VoiceSessionError)
  })
})

describe('endVoiceSession', () => {
  it('posts action end through functions.invoke', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await endVoiceSession({ sessionId: STARTED.sessionId, usage: USAGE, reason: 'user' })
    expect(invoke).toHaveBeenCalledWith('voice-session', {
      body: { action: 'end', sessionId: STARTED.sessionId, usage: USAGE, reason: 'user' },
    })
  })

  it('throws the server message when the end fails', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(404, { error: { code: 'NOT_FOUND', message: 'Voice session not found' } }) })
    await expect(endVoiceSession({ sessionId: STARTED.sessionId })).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Voice session not found' })
  })

  it('with keepalive, posts with fetch keepalive and the current access token', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } }, error: null })
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await endVoiceSession({ sessionId: STARTED.sessionId, reason: 'hidden' }, { keepalive: true })

    expect(invoke).not.toHaveBeenCalled()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/functions\/v1\/voice-session$/)
    expect(url.startsWith(import.meta.env.VITE_SUPABASE_URL)).toBe(true)
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    expect(init.headers).toEqual({
      Authorization: 'Bearer jwt-123',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(init.body as string)).toEqual({ action: 'end', sessionId: STARTED.sessionId, reason: 'hidden' })
  })

  it('with keepalive and no signed-in session, throws instead of posting', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(endVoiceSession({ sessionId: STARTED.sessionId }, { keepalive: true })).rejects.toBeInstanceOf(VoiceSessionError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('with keepalive, a non-2xx is an error', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } }, error: null })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await expect(endVoiceSession({ sessionId: STARTED.sessionId }, { keepalive: true })).rejects.toMatchObject({ status: 500 })
  })

  it('with keepalive and a cached token, posts in the same tick without reading the session', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const ending = endVoiceSession({ sessionId: STARTED.sessionId, reason: 'hidden' }, { keepalive: true, accessToken: 'cached-jwt' })
    // Nothing awaited yet: the request must already be on its way.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getSession).not.toHaveBeenCalled()
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.keepalive).toBe(true)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer cached-jwt')
    await ending
  })

  it('a cached token is ignored without keepalive: the ordinary end goes through functions.invoke', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await endVoiceSession({ sessionId: STARTED.sessionId }, { keepalive: false, accessToken: 'cached-jwt' })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('readAccessToken', () => {
  it('returns the signed-in user access token', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } }, error: null })
    await expect(readAccessToken()).resolves.toBe('jwt-123')
  })

  it('returns null when nobody is signed in, when the read errors, and when it throws', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null })
    await expect(readAccessToken()).resolves.toBeNull()
    getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('lock') })
    await expect(readAccessToken()).resolves.toBeNull()
    getSession.mockRejectedValueOnce(new Error('storage'))
    await expect(readAccessToken()).resolves.toBeNull()
  })
})
