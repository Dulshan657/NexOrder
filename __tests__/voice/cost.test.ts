import { describe, it, expect } from 'vitest'
import {
  MAX_REPORTED_TOKENS,
  REALTIME_PRICING,
  computeRealtimeCostUsd,
} from '../../supabase/functions/_shared/voice/cost'
import type { RealtimePricing, RealtimeUsage } from '../../supabase/functions/_shared/voice/cost'

const M = 1_000_000

const ZERO: RealtimeUsage = {
  inputTokens: 0,
  outputTokens: 0,
  inputAudioTokens: 0,
  inputTextTokens: 0,
  cachedInputTokens: 0,
  outputAudioTokens: 0,
  outputTextTokens: 0,
}

function usage(over: Partial<RealtimeUsage>): RealtimeUsage {
  return { ...ZERO, ...over }
}

// Text prices distinct from the shipped ones, passed in explicitly so the
// text-rate arithmetic is tested independently of what REALTIME_PRICING says.
const LISTED_TEXT: RealtimePricing = { ...REALTIME_PRICING, textInPer1M: 4, textOutPer1M: 16 }

describe('REALTIME_PRICING', () => {
  it('carries the verified audio prices and their date', () => {
    expect(REALTIME_PRICING.audioInPer1M).toBe(32)
    expect(REALTIME_PRICING.cachedInPer1M).toBe(0.4)
    expect(REALTIME_PRICING.audioOutPer1M).toBe(64)
    expect(REALTIME_PRICING.asOf).toBe('2026-10-20')
  })

  it('carries the verified text prices', () => {
    expect(REALTIME_PRICING.textInPer1M).toBe(4)
    expect(REALTIME_PRICING.textOutPer1M).toBe(24)
  })

  it('is frozen', () => {
    expect(Object.isFrozen(REALTIME_PRICING)).toBe(true)
  })
})

describe('computeRealtimeCostUsd', () => {
  it('is zero for no usage', () => {
    expect(computeRealtimeCostUsd(ZERO)).toBe(0)
  })

  it('prices a million audio tokens each way at the audio rates', () => {
    expect(computeRealtimeCostUsd(usage({ inputTokens: M, inputAudioTokens: M }))).toBe(32)
    expect(computeRealtimeCostUsd(usage({ outputTokens: M, outputAudioTokens: M }))).toBe(64)
    const both = usage({ inputTokens: M, inputAudioTokens: M, outputTokens: M, outputAudioTokens: M })
    expect(computeRealtimeCostUsd(both)).toBe(96)
  })

  it('prices text tokens at the text rates', () => {
    const textIn = usage({ inputTokens: M, inputTextTokens: M })
    const textOut = usage({ outputTokens: M, outputTextTokens: M })
    expect(computeRealtimeCostUsd(textIn, LISTED_TEXT)).toBe(4)
    expect(computeRealtimeCostUsd(textOut, LISTED_TEXT)).toBe(16)
  })

  it('defaults to the shipped prices', () => {
    const u = usage({ inputTokens: M, inputTextTokens: M })
    expect(computeRealtimeCostUsd(u)).toBe(computeRealtimeCostUsd(u, REALTIME_PRICING))
  })

  it('prices cached input at the cached rate instead of the audio rate', () => {
    const u = usage({ inputTokens: M, inputAudioTokens: M, cachedInputTokens: M / 2 })
    // 0.5M x 32 + 0.5M x 0.40
    expect(computeRealtimeCostUsd(u)).toBe(16.2)
  })

  it('takes cached tokens off the text input first', () => {
    const u = usage({
      inputTokens: 2 * M,
      inputAudioTokens: M,
      inputTextTokens: M,
      cachedInputTokens: M,
    })
    // All the text is cached: audio 1M x 32 + cached 1M x 0.40.
    expect(computeRealtimeCostUsd(u, LISTED_TEXT)).toBe(32.4)
  })

  it('never bills more cached tokens than there were input tokens', () => {
    const u = usage({ inputTokens: M, inputAudioTokens: M, cachedInputTokens: 2 * M })
    expect(computeRealtimeCostUsd(u)).toBe(0.4)
  })

  it('bills tokens the breakdown does not explain at the audio rate', () => {
    expect(computeRealtimeCostUsd(usage({ inputTokens: M }))).toBe(32)
    expect(computeRealtimeCostUsd(usage({ outputTokens: M }))).toBe(64)
  })

  it('does not double count tokens the breakdown does explain', () => {
    const u = usage({
      inputTokens: M,
      inputAudioTokens: M / 2,
      inputTextTokens: M / 2,
      outputTokens: M,
      outputAudioTokens: M / 2,
      outputTextTokens: M / 2,
    })
    // 0.5M x 4 + 0.5M x 32 + 0.5M x 16 + 0.5M x 64
    expect(computeRealtimeCostUsd(u, LISTED_TEXT)).toBe(2 + 16 + 8 + 32)
  })

  it('rounds to six decimal places', () => {
    expect(computeRealtimeCostUsd(usage({ inputTokens: 3, inputAudioTokens: 3 }))).toBe(0.000096)
    const cached = usage({ inputTokens: 3, inputAudioTokens: 3, cachedInputTokens: 1 })
    // (2 x 32 + 0.4) / 1e6 = 0.0000644, rounded to 0.000064
    expect(computeRealtimeCostUsd(cached)).toBe(0.000064)
  })

  it('prices a typical ten-minute conversation', () => {
    const u = usage({
      inputTokens: 9000,
      inputAudioTokens: 6000,
      inputTextTokens: 3000,
      cachedInputTokens: 2000,
      outputTokens: 5000,
      outputAudioTokens: 4500,
      outputTextTokens: 500,
    })
    // 2000 cached come off the 3000 text; 1000 text in at the text rate, 6000
    // audio in at the audio rate, 2000 cached at the cached rate, 500 text out
    // at the text rate and 4500 audio out at the audio rate (all per 1M tokens).
    const p = REALTIME_PRICING
    const expected =
      (1000 * p.textInPer1M +
        6000 * p.audioInPer1M +
        2000 * p.cachedInPer1M +
        500 * p.textOutPer1M +
        4500 * p.audioOutPer1M) /
      M
    expect(computeRealtimeCostUsd(u)).toBe(Math.round(expected * M) / M)
  })

  it('ignores negative and non-finite counts instead of producing nonsense', () => {
    const u = usage({
      inputTokens: Number.NaN,
      outputTokens: Number.POSITIVE_INFINITY,
      inputAudioTokens: -500,
      inputTextTokens: Number.NEGATIVE_INFINITY,
      cachedInputTokens: -1,
      outputAudioTokens: Number.NaN,
      outputTextTokens: -9,
    })
    expect(computeRealtimeCostUsd(u)).toBe(0)
  })

  it('does not change the usage it is given', () => {
    const u = usage({ inputTokens: 10, inputAudioTokens: 10 })
    const before = JSON.stringify(u)
    computeRealtimeCostUsd(u)
    expect(JSON.stringify(u)).toBe(before)
  })
})

describe('MAX_REPORTED_TOKENS', () => {
  it('fits the integer token columns', () => {
    expect(MAX_REPORTED_TOKENS).toBeGreaterThan(0)
    expect(MAX_REPORTED_TOKENS).toBeLessThanOrEqual(2 ** 31 - 1)
  })

  it('keeps the largest reportable cost inside numeric(10,6)', () => {
    const max = usage({
      inputTokens: MAX_REPORTED_TOKENS,
      outputTokens: MAX_REPORTED_TOKENS,
      inputAudioTokens: MAX_REPORTED_TOKENS,
      inputTextTokens: MAX_REPORTED_TOKENS,
      cachedInputTokens: MAX_REPORTED_TOKENS,
      outputAudioTokens: MAX_REPORTED_TOKENS,
      outputTextTokens: MAX_REPORTED_TOKENS,
    })
    expect(computeRealtimeCostUsd(max)).toBeLessThan(10_000)
  })
})
