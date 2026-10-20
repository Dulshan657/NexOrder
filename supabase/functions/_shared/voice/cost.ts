// Nex Assistant (voice) - what a Realtime session cost, from its token usage.
//
// PURE: shared by the voice-session Edge Function (which stores the cost when a
// session ends) and anything that shows it. Prices are USD per 1M tokens as of
// REALTIME_PRICING.asOf, from https://developers.openai.com/api/docs/pricing
// (gpt-realtime-2.1, checked 2026-10-20). They live here, not in a remote lookup, so a cost
// written to the ledger today never changes retroactively; when OpenAI changes
// prices, edit them AND bump `asOf`.
//
// The usage figures are the `response.usage` totals from response.done events.
// Input-audio transcription is billed separately by the transcription model and
// is not in them, so this is the cost of the conversation model only.

export interface RealtimePricing {
  readonly audioInPer1M: number
  readonly cachedInPer1M: number
  readonly audioOutPer1M: number
  readonly textInPer1M: number
  readonly textOutPer1M: number
  readonly asOf: string
}

export const REALTIME_PRICING: RealtimePricing = Object.freeze({
  // Source: https://developers.openai.com/api/docs/pricing (gpt-realtime-2.1).
  // Cached input is $0.40 for both text and audio, so one cached rate serves both.
  audioInPer1M: 32,
  cachedInPer1M: 0.4,
  audioOutPer1M: 64,
  textInPer1M: 4,
  textOutPer1M: 24,
  asOf: '2026-10-20',
})

export interface RealtimeUsage {
  inputTokens: number
  outputTokens: number
  inputAudioTokens: number
  inputTextTokens: number
  /** Cached tokens are a subset of the input tokens, not extra to them. */
  cachedInputTokens: number
  outputAudioTokens: number
  outputTextTokens: number
}

const TOKENS_PER_PRICE_UNIT = 1_000_000
const COST_DECIMALS = 6

/** A usable token count: finite and not negative, else 0. Usage comes from the client. */
function tokens(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function roundUsd(value: number): number {
  const factor = 10 ** COST_DECIMALS
  return Math.round(value * factor) / factor
}

/**
 * Cost of the input side. Tokens the audio/text breakdown does not explain are
 * billed at the audio rate. Cached tokens come off the text input first, then
 * audio, then the unexplained rest, and bill at the cached rate.
 */
function inputCostPer1M(usage: RealtimeUsage, pricing: RealtimePricing): number {
  const audio = tokens(usage.inputAudioTokens)
  const text = tokens(usage.inputTextTokens)
  const other = Math.max(0, tokens(usage.inputTokens) - audio - text)
  const cached = Math.min(tokens(usage.cachedInputTokens), audio + text + other)
  const cachedText = Math.min(cached, text)
  const cachedAudio = Math.min(cached - cachedText, audio)
  const uncachedText = text - cachedText
  const uncachedAudio = audio - cachedAudio + other - (cached - cachedText - cachedAudio)
  return (
    uncachedText * pricing.textInPer1M +
    uncachedAudio * pricing.audioInPer1M +
    cached * pricing.cachedInPer1M
  )
}

function outputCostPer1M(usage: RealtimeUsage, pricing: RealtimePricing): number {
  const audio = tokens(usage.outputAudioTokens)
  const text = tokens(usage.outputTextTokens)
  const other = Math.max(0, tokens(usage.outputTokens) - audio - text)
  return text * pricing.textOutPer1M + (audio + other) * pricing.audioOutPer1M
}

/** USD cost of one session's usage, rounded to 6 decimal places. */
export function computeRealtimeCostUsd(
  usage: RealtimeUsage,
  pricing: RealtimePricing = REALTIME_PRICING,
): number {
  const total = inputCostPer1M(usage, pricing) + outputCostPer1M(usage, pricing)
  return roundUsd(total / TOKENS_PER_PRICE_UNIT)
}
