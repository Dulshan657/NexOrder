// Pure mapping from a post-retry account state to the inline outcome the
// "Retry now" UI reports. Kept import-free so it's unit-testable under vitest
// (the retry-email-account handler and pollAccount engine pull Deno/https
// imports that vitest can't load).
//
// The subtlety this encodes: processAccount's CycleResult.status is 'error'
// for BOTH a transient failure (mailbox stays 'active', backs off) and a
// genuine grant revocation (flipped to 'error'). The authoritative DB status
// read back AFTER the poll is what disambiguates them.

export type RetryOutcome = 'synced' | 'still_failing' | 'needs_reconnect'

export function deriveRetryOutcome(
  afterStatus: string,
  cycleStatus: 'ok' | 'error',
): RetryOutcome {
  if (afterStatus === 'error') return 'needs_reconnect'
  if (cycleStatus === 'ok') return 'synced'
  return 'still_failing'
}
