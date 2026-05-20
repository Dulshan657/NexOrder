// Pure formatting + summary helpers for the Mailboxes UI. Kept in a .ts
// file (no React) so Vitest can exercise them. formatRelative was moved
// here out of EmailAccountsTab when that tab collapsed into MailboxesMenu.

import type { EmailAccountStatus } from '@/services/supabase/emailAccountsService'

/**
 * Lightweight relative-time formatter. Avoids a date library dependency.
 * Precision beyond "minutes ago" is not load-bearing.
 */
export function formatRelative(iso: string, nowMs: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'unknown'
  const deltaSec = Math.round((nowMs - t) / 1000)
  if (deltaSec < 60) return 'just now'
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)} min ago`
  if (deltaSec < 86_400) return `${Math.round(deltaSec / 3600)} h ago`
  return `${Math.round(deltaSec / 86_400)} d ago`
}

export type MailboxHealthTone = 'ok' | 'paused' | 'error'

export interface MailboxHealth {
  count: number
  erroredCount: number
  pausedCount: number
  tone: MailboxHealthTone
}

/**
 * Summarises connected mailboxes for the header button's health dot.
 * error wins over paused wins over ok.
 */
export function summarizeMailboxHealth(
  accounts: ReadonlyArray<{ status: EmailAccountStatus }>,
): MailboxHealth {
  let erroredCount = 0
  let pausedCount = 0
  for (const a of accounts) {
    if (a.status === 'error') erroredCount += 1
    else if (a.status === 'paused') pausedCount += 1
  }
  const tone: MailboxHealthTone =
    erroredCount > 0 ? 'error' : pausedCount > 0 ? 'paused' : 'ok'
  return { count: accounts.length, erroredCount, pausedCount, tone }
}
