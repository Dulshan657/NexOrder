// Keeps an unfinished goods receipt across leaving the screen (NX-0005 A13).
//
// The owner lost a half-scanned delivery to one stray click on the sidebar:
// switching tabs unmounts Receive Stock, and everything staged lived in
// component state. A reload, or Android discarding a background tab on the
// RS35, did the same.
//
// Browser storage is the right home and the only one: a draft is a per-viewer
// convenience — never shared, never read by the server, and losing it costs a
// re-scan, not data. So:
//   - keyed by USER, because a dock handheld is shared between shifts;
//   - expires after a day, so yesterday's forgotten receipt never comes back
//     looking like today's truck;
//   - every access is wrapped, because storage can be missing or throw
//     (private window, blocked site data, a full quota) and the screen must
//     work regardless;
//   - pure over an injected `Storage`, so it is tested without a DOM.

import type { DraftLine, DraftPlate } from './receiveDraft'

const KEY_PREFIX = 'nexorder_v1_receive_draft:'
const VERSION = 1

/** A day. A receipt left longer than this is not "unfinished", it is abandoned. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

/** Everything the operator has typed or staged — and nothing derived. */
export interface ReceiveDraftSnapshot {
  supplierId: number | null
  supplierName: string
  reference: string
  receivedDate: string
  quarantineAll: boolean
  destinationId: number | null
  lines: DraftLine[]
  plates: DraftPlate[]
  activeGroupKey: string | null
  forceNewPallet: boolean
}

export interface LoadedReceiveDraft {
  draft: ReceiveDraftSnapshot
  /** Epoch ms of the last save, for "restored from 10:42". */
  savedAt: number
}

type UserKey = string | number | null | undefined

const keyFor = (userId: UserKey): string | null =>
  userId == null || userId === '' ? null : `${KEY_PREFIX}${userId}`

const defaultStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    // Accessing localStorage itself throws when site data is blocked.
    return null
  }
}

/** True when there is nothing worth restoring. */
function isEmpty(d: ReceiveDraftSnapshot): boolean {
  return d.lines.length === 0
    && d.plates.length === 0
    && d.supplierName.trim() === ''
    && d.reference.trim() === ''
    && !d.quarantineAll
}

/** Structural check of what came back from storage — it is external data. */
function isSnapshot(value: unknown): value is ReceiveDraftSnapshot {
  if (!value || typeof value !== 'object') return false
  const d = value as Record<string, unknown>
  return Array.isArray(d.lines)
    && Array.isArray(d.plates)
    && typeof d.supplierName === 'string'
    && typeof d.reference === 'string'
    && typeof d.receivedDate === 'string'
    && typeof d.quarantineAll === 'boolean'
    && typeof d.forceNewPallet === 'boolean'
    && d.lines.every((l) => !!l && typeof l === 'object' && typeof (l as DraftLine).key === 'string'
      && typeof (l as DraftLine).plateKey === 'string' && typeof (l as DraftLine).quantity === 'string')
    && d.plates.every((p) => !!p && typeof p === 'object' && typeof (p as DraftPlate).key === 'string')
}

export function saveReceiveDraft(
  userId: UserKey,
  draft: ReceiveDraftSnapshot,
  storage: Storage | null = defaultStorage(),
  now: number = Date.now(),
): void {
  const key = keyFor(userId)
  if (!key || !storage) return
  try {
    if (isEmpty(draft)) {
      storage.removeItem(key)
      return
    }
    storage.setItem(key, JSON.stringify({ v: VERSION, savedAt: now, draft }))
  } catch {
    // Quota or blocked storage: the screen keeps working, it just won't persist.
  }
}

export function loadReceiveDraft(
  userId: UserKey,
  storage: Storage | null = defaultStorage(),
  now: number = Date.now(),
): LoadedReceiveDraft | null {
  const key = keyFor(userId)
  if (!key || !storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; draft?: unknown }
    if (parsed?.v !== VERSION || typeof parsed.savedAt !== 'number' || !isSnapshot(parsed.draft)) {
      return null
    }
    if (now - parsed.savedAt > DRAFT_TTL_MS) {
      storage.removeItem(key)
      return null
    }
    return { draft: parsed.draft, savedAt: parsed.savedAt }
  } catch {
    return null
  }
}

export function clearReceiveDraft(userId: UserKey, storage: Storage | null = defaultStorage()): void {
  const key = keyFor(userId)
  if (!key || !storage) return
  try {
    storage.removeItem(key)
  } catch {
    // Nothing to do: the draft will expire on its own.
  }
}
