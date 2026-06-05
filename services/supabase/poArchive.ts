// Pure archive-cutoff logic for the PO Inbox, kept free of the Supabase client
// import so it can be unit-tested in a node environment (poInboxService pulls in
// lib/supabase, which throws without VITE_SUPABASE_* env vars).
//
// A resolved PO (approved / auto_approved / rejected) stays in the active Queue
// for ARCHIVE_AFTER_DAYS from its resolution time (pending_pos.updated_at), then
// moves to the Archive sub-tab. needs_review POs never archive.

import type { PendingPoStatus } from './poInboxService'

/** Days a resolved PO stays in the active Queue before moving to the Archive. */
export const ARCHIVE_AFTER_DAYS = 30

/** Statuses that age out of the Queue into the Archive once resolved long enough. */
export const ARCHIVABLE_STATUSES: PendingPoStatus[] = ['approved', 'auto_approved', 'rejected']

const DAY_MS = 86_400_000

/** ISO timestamp `ARCHIVE_AFTER_DAYS` before `now`. Resolved POs whose
 *  resolution time (pending_pos.updated_at) is older than this are archived. */
export function archiveCutoffIso(now: number = Date.now()): string {
  return new Date(now - ARCHIVE_AFTER_DAYS * DAY_MS).toISOString()
}

/** Whether a resolved PO has aged into the Archive (by status + resolution time). */
export function isArchivable(
  status: PendingPoStatus,
  resolvedAtIso: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!ARCHIVABLE_STATUSES.includes(status)) return false
  if (!resolvedAtIso) return false
  return new Date(resolvedAtIso).getTime() < now - ARCHIVE_AFTER_DAYS * DAY_MS
}
