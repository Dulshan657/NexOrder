import { describe, it, expect } from 'vitest'

import {
  ARCHIVE_ENVELOPE_NAME,
  archivePrefixCandidates,
  isSafeStoredName,
  pickAttachmentName,
  sortStoredNames,
} from '../supabase/functions/_shared/poInbox/archivePaths'
import {
  attachmentPath,
  storagePrefixFor,
} from '../supabase/functions/_shared/poInbox/pollDispatch'

describe('archivePrefixCandidates', () => {
  it('offers the decoded prefix first for encoded (Graph) message ids', () => {
    // list() compares its prefix literally; every path-based call is decoded
    // by storage-api. The decoded form is the key Storage actually wrote.
    expect(archivePrefixCandidates('acct-123/AAMkAGI%2FAQ%3D')).toEqual([
      'acct-123/AAMkAGI/AQ=',
      'acct-123/AAMkAGI%2FAQ%3D',
    ])
  })

  it('returns a single entry for a plain (Gmail) prefix', () => {
    expect(archivePrefixCandidates('acct-123/17abc')).toEqual(['acct-123/17abc'])
  })

  it('does not throw on a malformed percent escape', () => {
    expect(archivePrefixCandidates('acct-123/100%off')).toEqual(['acct-123/100%off'])
  })
})

describe('isSafeStoredName', () => {
  it('accepts a real stored attachment name', () => {
    expect(isSafeStoredName('0-2 - Exec 300 PO 228332 PURCHASE ORDER.pdf')).toBe(true)
  })

  it('rejects anything that could escape the message prefix', () => {
    expect(isSafeStoredName('../secret')).toBe(false)
    expect(isSafeStoredName('a/b.pdf')).toBe(false)
    expect(isSafeStoredName('a\\b.pdf')).toBe(false)
    expect(isSafeStoredName('.hidden')).toBe(false)
  })

  it('rejects the archived envelope and non-strings', () => {
    expect(isSafeStoredName(ARCHIVE_ENVELOPE_NAME)).toBe(false)
    expect(isSafeStoredName('')).toBe(false)
    expect(isSafeStoredName(undefined)).toBe(false)
    expect(isSafeStoredName(null)).toBe(false)
    expect(isSafeStoredName(42)).toBe(false)
  })
})

describe('sortStoredNames', () => {
  it('sorts without mutating the input', () => {
    const input = ['1-b.pdf', '0-a.pdf']
    expect(sortStoredNames(input)).toEqual(['0-a.pdf', '1-b.pdf'])
    expect(input).toEqual(['1-b.pdf', '0-a.pdf'])
  })
})

describe('pickAttachmentName', () => {
  const names = ['0-sig.png', '1-order.pdf']

  it('matches an exact stored name', () => {
    expect(pickAttachmentName(names, { name: '1-order.pdf' })).toBe('1-order.pdf')
  })

  it('returns null on a name miss rather than falling back to a position', () => {
    // Position 0 is often the inline signature image — showing the wrong
    // document silently is worse than an error.
    expect(pickAttachmentName(names, { name: '1-order.PDF', index: 0 })).toBeNull()
  })

  it('prefers the name over the index when both are supplied', () => {
    expect(pickAttachmentName(names, { name: '1-order.pdf', index: 0 })).toBe('1-order.pdf')
  })

  it('falls back to the positional index when no name is given', () => {
    expect(pickAttachmentName(names, { index: 0 })).toBe('0-sig.png')
    expect(pickAttachmentName(names, { name: '', index: 1 })).toBe('1-order.pdf')
  })

  it('returns null for an out-of-range or absent index', () => {
    expect(pickAttachmentName(names, { index: 7 })).toBeNull()
    expect(pickAttachmentName(names, {})).toBeNull()
    expect(pickAttachmentName([], { index: 0 })).toBeNull()
  })
})

describe('round trip: write-time name matches read-time lookup', () => {
  // The exact case that produced "no attachment named 0-2 - Exec 300 PO
  // 228332 PURCHASE ORDER.pdf": a Graph message id (encoded in the prefix)
  // carrying a PDF whose stored name is what extract-po records into
  // extracted_po.source.original_filename and the viewer asks for by name.
  const prefix = storagePrefixFor('acct-123', 'AAMkAGI/AQ=')
  const fullPath = attachmentPath(prefix, 0, '2 - Exec 300 PO 228332 PURCHASE ORDER.pdf')
  // pollAccount derives storedName exactly this way.
  const storedName = fullPath.slice(prefix.length + 1)

  it('produces the stored name seen in the bug report', () => {
    expect(storedName).toBe('0-2 - Exec 300 PO 228332 PURCHASE ORDER.pdf')
  })

  it('is a safe single segment and resolves by name', () => {
    expect(isSafeStoredName(storedName)).toBe(true)
    expect(pickAttachmentName(sortStoredNames([storedName]), { name: storedName })).toBe(
      storedName,
    )
  })

  it('is listable under the decoded prefix, not the stored one', () => {
    const [decoded, raw] = archivePrefixCandidates(prefix)
    expect(raw).toBe(prefix)
    expect(decoded).toBe('acct-123/AAMkAGI/AQ=')
  })
})
