// Running token totals for one Realtime session, summed from each response.done.
//
// PURE. The totals are what the voice-session function stores when the session
// ends, and that function REJECTS a figure that is not a whole number between 0
// and MAX_REPORTED_TOKENS. A rejected end leaves the ledger row open (and charged
// at the full session cap), so every figure is clamped here rather than sent raw.

import { MAX_REPORTED_TOKENS } from '@/supabase/functions/_shared/voice/cost'
import type { RealtimeUsage } from '@/supabase/functions/_shared/voice/cost'
import type { ResponseUsage } from './realtimeEvents'

export const ZERO_USAGE: RealtimeUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  inputAudioTokens: 0,
  inputTextTokens: 0,
  cachedInputTokens: 0,
  outputAudioTokens: 0,
  outputTextTokens: 0,
})

/** A usable count: finite, not negative, whole. */
function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function sum(a: number, b: number | undefined): number {
  return Math.min(MAX_REPORTED_TOKENS, a + count(b))
}

/** `total` plus one response's usage, as a new object. A missing usage adds nothing. */
export function addUsage(total: RealtimeUsage, usage: ResponseUsage | undefined): RealtimeUsage {
  if (!usage) return total
  return {
    inputTokens: sum(total.inputTokens, usage.input_tokens),
    outputTokens: sum(total.outputTokens, usage.output_tokens),
    inputAudioTokens: sum(total.inputAudioTokens, usage.input_token_details?.audio_tokens),
    inputTextTokens: sum(total.inputTextTokens, usage.input_token_details?.text_tokens),
    cachedInputTokens: sum(total.cachedInputTokens, usage.input_token_details?.cached_tokens),
    outputAudioTokens: sum(total.outputAudioTokens, usage.output_token_details?.audio_tokens),
    outputTextTokens: sum(total.outputTextTokens, usage.output_token_details?.text_tokens),
  }
}
