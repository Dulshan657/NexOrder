// Pure formatting helpers for the PO Inbox stats tile. Vitest-friendly.

/**
 * Render an auto-approval ratio as "X of Y · 50%" so operators see both
 * the absolute and relative numbers. Auto-approval is a key health
 * metric — falling below ~40% suggests the AI is no longer matching
 * customers/products well.
 */
export function describeRatio(ratio: number, autoApproved: number): string {
  const pct = Number.isFinite(ratio) ? Math.round(ratio * 100) : 0
  return `${autoApproved} · ${pct}%`
}

/**
 * Render a cost value in USD. Anything below $0.01 shows fractional
 * cents (typical for gpt-4o-mini classifier hits). Null = "—".
 */
export function describeCost(value: number | null): string {
  if (value == null) return '—'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

/**
 * Tone-classification for a count against a `(amber, rose)` threshold
 * tuple. Used to colour the backlog stat: zero is default, small is
 * amber, large is rose.
 */
export function thresholdTone(
  count: number,
  thresholds: readonly [number, number],
): 'default' | 'amber' | 'rose' {
  if (count >= thresholds[1]) return 'rose'
  if (count >= thresholds[0]) return 'amber'
  return 'default'
}
