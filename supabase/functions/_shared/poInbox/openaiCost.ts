// Cost calculation for OpenAI usage — pure helpers exported so the
// audit-logging path in openai.ts and the cost-dashboard tile in
// Stream H can share the same prices.
//
// Prices are USD per 1M tokens, accurate as of 2026-05. They are
// intentionally kept here (not pulled from a remote source) so the cost
// number written to po_extraction_audit is stable — historical analysis
// would otherwise be retroactively rewritten by a price change. When
// OpenAI changes prices, bump these constants AND add a row tagging the
// "as_of" date so old rows keep their old cost stamp.

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPer1M: number
  /** USD per 1M output tokens. */
  outputPer1M: number
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
}

/**
 * Compute USD cost for a single OpenAI call. Returns null when the model
 * is unknown rather than guessing — callers should log a warning but
 * proceed (no cost in the audit row is better than a wrong cost).
 */
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return null
  if (
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0
  ) {
    return null
  }
  const input = (inputTokens / 1_000_000) * pricing.inputPer1M
  const output = (outputTokens / 1_000_000) * pricing.outputPer1M
  return roundTo(input + output, 6)
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * SHA-256 of the normalized prompt, hex-encoded. Used to identify
 * repeated prompts for cache analysis in Stream H. Web Crypto is
 * available in Deno and Node 18+. Returns the empty string if Web
 * Crypto is unavailable (defensive — never throws from the audit path).
 */
export async function promptHash(text: string): Promise<string> {
  if (!text) return ''
  try {
    const bytes = new TextEncoder().encode(text)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    let hex = ''
    for (let i = 0; i < digest.length; i++) {
      hex += digest[i].toString(16).padStart(2, '0')
    }
    return hex
  } catch {
    return ''
  }
}
