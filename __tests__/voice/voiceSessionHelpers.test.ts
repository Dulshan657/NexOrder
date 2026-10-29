// The two pure helpers behind useVoiceSession: usage totals and error mapping.

import { describe, expect, it } from 'vitest'
import { ZERO_USAGE, addUsage } from '@/lib/voice/realtimeUsage'
import { MIC_DENIED_MESSAGE, micError, startError, voiceError } from '@/lib/voice/voiceErrors'
import { MAX_REPORTED_TOKENS } from '@/supabase/functions/_shared/voice/cost'

describe('addUsage', () => {
  it('adds a response to the total without changing either', () => {
    const total = addUsage(ZERO_USAGE, { input_tokens: 5, output_tokens: 7, input_token_details: { cached_tokens: 2 } })
    expect(total).toEqual({ ...ZERO_USAGE, inputTokens: 5, outputTokens: 7, cachedInputTokens: 2 })
    expect(ZERO_USAGE.inputTokens).toBe(0)
    expect(addUsage(total, undefined)).toBe(total)
  })

  it('keeps every figure a whole number the server accepts', () => {
    const huge = addUsage(ZERO_USAGE, { input_tokens: MAX_REPORTED_TOKENS + 5, output_tokens: -3 })
    expect(huge.inputTokens).toBe(MAX_REPORTED_TOKENS)
    expect(huge.outputTokens).toBe(0)
    expect(addUsage(ZERO_USAGE, { input_tokens: 2.7 }).inputTokens).toBe(2)
    expect(addUsage(ZERO_USAGE, { input_tokens: Number.NaN }).inputTokens).toBe(0)
  })
})

describe('voice error mapping', () => {
  it('maps getUserMedia rejections', () => {
    expect(micError({ name: 'NotAllowedError' })).toEqual({ kind: 'mic-denied', message: MIC_DENIED_MESSAGE })
    expect(micError({ name: 'SecurityError' }).kind).toBe('mic-denied')
    expect(micError({ name: 'NotFoundError' }).kind).toBe('no-mic')
    expect(micError(new Error('weird')).kind).toBe('no-mic')
  })

  it('an envelope-less failure is offline when the browser is, else upstream with the default text', () => {
    expect(startError(new Error('Failed to fetch'), false).kind).toBe('offline')
    expect(startError(new Error('Failed to fetch'), true)).toEqual(voiceError('upstream'))
  })

  it('a blank server message falls back to the default', () => {
    expect(voiceError('budget', '  ').message).toBe(voiceError('budget').message)
  })
})
