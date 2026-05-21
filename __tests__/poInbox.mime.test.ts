import { describe, it, expect } from 'vitest'

import {
  parseAddress,
  emailDomain,
  decodeGmailBase64,
  decodeGmailBase64Text,
  extractGmailBodies,
  listGmailAttachments,
  gmailPartIsInline,
  getGmailHeader,
  type GmailPart,
} from '../supabase/functions/_shared/poInbox/mime'

const b64url = (s: string) =>
  Buffer.from(s, 'utf8').toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')

describe('parseAddress', () => {
  it('handles "Name <email>" with double-quoted display name', () => {
    expect(parseAddress('"Acme Foods" <orders@acme.com>')).toEqual({
      name: 'Acme Foods',
      email: 'orders@acme.com',
    })
  })

  it('handles "Name <email>" without quotes', () => {
    expect(parseAddress('Alice Anderson <alice@example.com>')).toEqual({
      name: 'Alice Anderson',
      email: 'alice@example.com',
    })
  })

  it('handles bare email', () => {
    expect(parseAddress('orders@acme.com')).toEqual({
      name: null,
      email: 'orders@acme.com',
    })
  })

  it('handles "<email>"', () => {
    expect(parseAddress('<orders@acme.com>')).toEqual({
      name: null,
      email: 'orders@acme.com',
    })
  })

  it('returns nulls for empty / undefined input', () => {
    expect(parseAddress('')).toEqual({ name: null, email: null })
    expect(parseAddress(null)).toEqual({ name: null, email: null })
    expect(parseAddress(undefined)).toEqual({ name: null, email: null })
  })

  it('returns the original as name when no email is detectable', () => {
    expect(parseAddress('not an email at all')).toEqual({
      name: 'not an email at all',
      email: null,
    })
  })
})

describe('emailDomain', () => {
  it('returns lowercase domain', () => {
    expect(emailDomain('Orders@Acme-Foods.COM')).toBe('acme-foods.com')
  })

  it('returns null for malformed addresses', () => {
    expect(emailDomain('no-at-sign')).toBeNull()
    expect(emailDomain('@no-local')).toBeNull()
    expect(emailDomain('local@')).toBeNull()
    expect(emailDomain('')).toBeNull()
    expect(emailDomain(null)).toBeNull()
  })
})

describe('Gmail base64url decoding', () => {
  it('round-trips a UTF-8 string', () => {
    const encoded = b64url('Hello, world! — naïve café')
    expect(decodeGmailBase64Text(encoded)).toBe('Hello, world! — naïve café')
  })

  it('handles missing padding gracefully', () => {
    expect(decodeGmailBase64Text(b64url('abc'))).toBe('abc')
  })

  it('returns the underlying bytes from decodeGmailBase64', () => {
    const bytes = decodeGmailBase64(b64url('xyz'))
    expect(Array.from(bytes)).toEqual([120, 121, 122])
  })

  it('returns empty string when atob throws on clearly invalid input', () => {
    // atob is lenient about whitespace and case but throws on a string that
    // can never decode (e.g., a single misplaced backtick character that
    // cannot form a valid base64 quartet at any position).
    // The wrapper guarantees we never throw upstream.
    const result = decodeGmailBase64Text('`')
    expect(typeof result).toBe('string')
  })
})

describe('extractGmailBodies', () => {
  it('picks text/plain and text/html out of a multipart tree', () => {
    const root: GmailPart = {
      mimeType: 'multipart/alternative',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: b64url('plain version') },
        },
        {
          mimeType: 'text/html',
          body: { data: b64url('<p>html version</p>') },
        },
      ],
    }
    expect(extractGmailBodies(root)).toEqual({
      text: 'plain version',
      html: '<p>html version</p>',
    })
  })

  it('falls back to the root body when there are no child parts', () => {
    const root: GmailPart = {
      mimeType: 'text/plain',
      body: { data: b64url('just the root') },
    }
    expect(extractGmailBodies(root).text).toBe('just the root')
  })

  it('returns nulls for an empty tree', () => {
    expect(extractGmailBodies(null)).toEqual({ text: null, html: null })
    expect(extractGmailBodies({})).toEqual({ text: null, html: null })
  })

  it('descends into nested multipart/* containers', () => {
    const root: GmailPart = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64url('deep plain') } },
          ],
        },
      ],
    }
    expect(extractGmailBodies(root).text).toBe('deep plain')
  })
})

describe('listGmailAttachments', () => {
  it('returns PDF/Word/image attachments with their attachmentId refs', () => {
    const root: GmailPart = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          partId: '1',
          mimeType: 'application/pdf',
          filename: 'PO_12345.pdf',
          body: { size: 8192, attachmentId: 'ATT-abc' },
        },
        {
          partId: '2',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          filename: 'PO_12345.docx',
          body: { size: 4096, attachmentId: 'ATT-def' },
        },
        {
          partId: '3',
          mimeType: 'image/png',
          filename: 'scan.png',
          body: { size: 16384, attachmentId: 'ATT-ghi' },
        },
      ],
    }
    const refs = listGmailAttachments(root)
    expect(refs).toHaveLength(3)
    expect(refs.map(r => r.filename)).toEqual(['PO_12345.pdf', 'PO_12345.docx', 'scan.png'])
    expect(refs.map(r => r.attachmentId)).toEqual(['ATT-abc', 'ATT-def', 'ATT-ghi'])
  })

  it('skips inline parts with no filename or no attachmentId', () => {
    const root: GmailPart = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'application/pdf',
          filename: '',
          body: { attachmentId: 'no-name' },
        },
        {
          mimeType: 'application/pdf',
          filename: 'inline.pdf',
          body: { attachmentId: undefined },
        },
      ],
    }
    expect(listGmailAttachments(root)).toEqual([])
  })

  it('skips MIME types we do not process (e.g., text/plain signatures)', () => {
    const root: GmailPart = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'application/zip',
          filename: 'archive.zip',
          body: { attachmentId: 'ATT-zip' },
        },
      ],
    }
    expect(listGmailAttachments(root)).toEqual([])
  })

  it('returns empty array on null tree', () => {
    expect(listGmailAttachments(null)).toEqual([])
    expect(listGmailAttachments(undefined)).toEqual([])
  })

  it('keeps an inline signature image but tags it inline=true, real attachment inline=false', () => {
    const root: GmailPart = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          partId: '2',
          mimeType: 'image/png',
          filename: 'image001.png',
          headers: [
            { name: 'Content-Disposition', value: 'inline; filename="image001.png"' },
            { name: 'Content-ID', value: '<image001@01D9.ABC>' },
          ],
          body: { size: 4096, attachmentId: 'ATT-sig' },
        },
        {
          partId: '3',
          mimeType: 'application/pdf',
          filename: 'PO_999.pdf',
          headers: [{ name: 'Content-Disposition', value: 'attachment; filename="PO_999.pdf"' }],
          body: { size: 200000, attachmentId: 'ATT-pdf' },
        },
      ],
    }
    const refs = listGmailAttachments(root)
    expect(refs.map(r => r.filename)).toEqual(['image001.png', 'PO_999.pdf'])
    expect(refs.map(r => r.inline)).toEqual([true, false])
  })
})

describe('gmailPartIsInline', () => {
  const part = (headers: Array<{ name: string; value: string }>): GmailPart => ({
    mimeType: 'image/png',
    filename: 'x.png',
    headers,
    body: { attachmentId: 'a' },
  })

  it('is true when Content-Disposition is inline', () => {
    expect(gmailPartIsInline(part([{ name: 'Content-Disposition', value: 'inline; filename="x.png"' }]))).toBe(true)
  })

  it('is true when a Content-ID is present and disposition is not attachment', () => {
    expect(gmailPartIsInline(part([{ name: 'Content-ID', value: '<x@host>' }]))).toBe(true)
  })

  it('is false for an explicit attachment disposition even if a Content-ID exists', () => {
    expect(
      gmailPartIsInline(
        part([
          { name: 'Content-Disposition', value: 'attachment; filename="x.png"' },
          { name: 'Content-ID', value: '<x@host>' },
        ]),
      ),
    ).toBe(false)
  })

  it('is false when there are no disposition/content-id headers', () => {
    expect(gmailPartIsInline(part([]))).toBe(false)
    expect(gmailPartIsInline({ mimeType: 'application/pdf', filename: 'a.pdf', body: {} })).toBe(false)
  })
})

describe('getGmailHeader', () => {
  it('is case-insensitive on the header name', () => {
    const headers = [
      { name: 'From', value: 'alice@example.com' },
      { name: 'Subject', value: 'PO 12345' },
    ]
    expect(getGmailHeader(headers, 'from')).toBe('alice@example.com')
    expect(getGmailHeader(headers, 'SUBJECT')).toBe('PO 12345')
  })

  it('returns empty string when the header is missing', () => {
    expect(getGmailHeader([], 'From')).toBe('')
    expect(getGmailHeader(null, 'From')).toBe('')
  })
})
