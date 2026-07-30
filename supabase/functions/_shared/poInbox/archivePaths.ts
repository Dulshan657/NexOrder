// Resolving objects inside the po-archive bucket.
//
// WHY THIS FILE EXISTS — the Supabase Storage client is asymmetric about
// where a path travels, and `inbound_messages.storage_path_prefix` is
// percent-encoded:
//
//   storagePrefixFor() encodes the provider message id, because Microsoft
//   Graph ids carry '/' and '=':
//       acct-123/AAMkAGI/AQ=   ->   acct-123/AAMkAGI%2FAQ%3D
//
//   * upload / download put the path in the REQUEST URL, which storage-api
//     decodes — so the objects were written under the DECODED prefix. A
//     Storage key may not contain '%' at all (the API answers 400
//     `InvalidKey`), so the decoded spelling is the only one that can exist.
//   * list() puts the prefix in the REQUEST BODY, where it is compared
//     literally — still percent-encoded, so it matches nothing.
//   * createSignedUrl signs the ENCODED spelling happily and hands back a URL
//     that 400s `InvalidKey` when fetched. The signing call reports success.
//
// The result was a PO whose PDF extracted fine (extract-po downloads by path)
// but whose viewer said "no attachment named ..." — and, once that was fixed,
// handed back a signed URL that would not load. The durable fix is to LIST the
// candidate prefixes and use whichever one actually returns objects: that is
// the spelling the objects live under, so it is also the one to sign.
//
// Dependency-free on purpose: imported by Deno Edge Functions and by the
// vitest suite, same rule as documentNotes.ts / extractionSchema.ts.

/**
 * Prefix spellings to try when listing an archived message's objects.
 * Decoded first — that is the key Storage actually wrote under. Falls back to
 * the raw prefix, which is correct for un-encoded (Gmail) ids and for any
 * archive written before the encoding existed.
 */
export function archivePrefixCandidates(inBucketPrefix: string): string[] {
  let decoded: string
  try {
    decoded = decodeURIComponent(inBucketPrefix)
  } catch {
    // A malformed '%' escape — the raw prefix is all we have.
    return [inBucketPrefix]
  }
  return decoded === inBucketPrefix ? [inBucketPrefix] : [decoded, inBucketPrefix]
}

/** The archived envelope object, excluded from every attachment listing. */
export const ARCHIVE_ENVELOPE_NAME = 'original.json'

/**
 * A stored attachment name must be a single path segment living directly
 * under the message prefix. The manifest is written by our own poller, but
 * the filenames inside it originate in email — this keeps the resolved path
 * pinned to the caller's prefix by construction rather than by trust.
 */
export function isSafeStoredName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  if (name.length === 0) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name.startsWith('.')) return false
  // The archived envelope is not an attachment.
  if (name === ARCHIVE_ENVELOPE_NAME) return false
  return true
}

export interface AttachmentChoice {
  /** Exact stored object name, e.g. "0-order.pdf". Takes precedence. */
  name?: string
  /** Positional fallback into the sorted name list. */
  index?: number
}

/**
 * Choose one attachment from a sorted list of stored object names.
 * Returns null on a miss — callers decide what that means; there is
 * deliberately no fuzzy fallback from a missed name to position 0, because
 * position 0 is often an inline signature image and showing the wrong
 * document silently is worse than an error.
 */
export function pickAttachmentName(
  names: string[],
  choice: AttachmentChoice,
): string | null {
  if (typeof choice.name === 'string' && choice.name.length > 0) {
    return names.find(n => n === choice.name) ?? null
  }
  if (Number.isInteger(choice.index) && (choice.index as number) >= 0) {
    return names[choice.index as number] ?? null
  }
  return null
}

/** Stable ordering for positional lookups. Sorts a copy — never mutates. */
export function sortStoredNames(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b))
}
