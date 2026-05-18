import { describe, it, expect, afterEach } from 'vitest'

import {
  attachmentPath,
  constantTimeEquals,
  formatLastError,
  isAuthorizedCronCall,
  originalPath,
  storagePrefixFor,
} from '../supabase/functions/_shared/poInbox/pollDispatch'

afterEach(() => {
  delete process.env.POLL_INBOX_CRON_TOKEN
})

describe('constantTimeEquals', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true)
    expect(constantTimeEquals('', '')).toBe(true)
  })

  it('returns false for different strings of equal length', () => {
    expect(constantTimeEquals('abc', 'abd')).toBe(false)
  })

  it('returns false for different lengths', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false)
  })
})

describe('isAuthorizedCronCall', () => {
  it('rejects when env var is unset', () => {
    delete process.env.POLL_INBOX_CRON_TOKEN
    expect(isAuthorizedCronCall('Bearer x')).toBe(false)
  })

  it('rejects when Authorization is missing', () => {
    process.env.POLL_INBOX_CRON_TOKEN = 'sek'
    expect(isAuthorizedCronCall(null)).toBe(false)
  })

  it("rejects non-Bearer schemes", () => {
    process.env.POLL_INBOX_CRON_TOKEN = 'sek'
    expect(isAuthorizedCronCall('Basic c2VrOg==')).toBe(false)
  })

  it('rejects mismatched token', () => {
    process.env.POLL_INBOX_CRON_TOKEN = 'sek'
    expect(isAuthorizedCronCall('Bearer wrong')).toBe(false)
  })

  it('accepts matching token (case-insensitive scheme)', () => {
    process.env.POLL_INBOX_CRON_TOKEN = 'sek'
    expect(isAuthorizedCronCall('Bearer sek')).toBe(true)
    expect(isAuthorizedCronCall('bearer sek')).toBe(true)
  })

  it('tolerates trailing whitespace on the token portion', () => {
    process.env.POLL_INBOX_CRON_TOKEN = 'sek'
    expect(isAuthorizedCronCall('Bearer sek  ')).toBe(true)
  })
})

describe('storagePrefixFor', () => {
  it('URL-encodes provider message IDs (Microsoft uses / and =)', () => {
    expect(storagePrefixFor('acct-123', 'AAMkAGI/AQ='))
      .toBe('acct-123/AAMkAGI%2FAQ%3D')
  })

  it('passes plain alphanumeric IDs through', () => {
    expect(storagePrefixFor('acct-123', '17abc')).toBe('acct-123/17abc')
  })
})

describe('originalPath', () => {
  it('appends original.json to the prefix', () => {
    expect(originalPath('acct-123/msg-1')).toBe('acct-123/msg-1/original.json')
  })
})

describe('attachmentPath', () => {
  it('produces a {prefix}/{index}-{safe-name} path', () => {
    expect(attachmentPath('acct-1/msg-1', 0, 'PO_12345.pdf'))
      .toBe('acct-1/msg-1/0-PO_12345.pdf')
  })

  it('strips path-traversal sequences', () => {
    const result = attachmentPath('acct-1/msg-1', 0, '../../../etc/passwd')
    expect(result).not.toContain('..')
    expect(result.startsWith('acct-1/msg-1/0-')).toBe(true)
  })

  it('strips slashes from the filename', () => {
    expect(attachmentPath('acct-1/msg-1', 1, 'foo/bar.pdf'))
      .toBe('acct-1/msg-1/1-foo_bar.pdf')
  })

  it('strips control characters (tabs, newlines)', () => {
    expect(attachmentPath('p', 0, 'foo\tbar\n.pdf')).toBe('p/0-foo_bar_.pdf')
  })

  it('falls back to a positional name when the input is empty after cleaning', () => {
    expect(attachmentPath('p', 3, '////')).toBe('p/3-attachment-3')
  })

  it('truncates very long names to 200 chars after sanitization', () => {
    const long = 'x'.repeat(500) + '.pdf'
    const result = attachmentPath('p', 0, long)
    // The {index}- prefix is added after the truncation, so total length
    // is (200 + len('0-') + len('p/')) ≈ 204.
    expect(result.startsWith('p/0-')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(220)
  })
})

describe('formatLastError', () => {
  it('formats Error instances with name and message', () => {
    const err = new TypeError('boom')
    expect(formatLastError(err)).toBe('TypeError: boom')
  })

  it('redacts OAuth-token-shaped substrings in the formatted message', () => {
    const err = new Error('upstream returned ya29.AccessToken_HereLooksLong')
    expect(formatLastError(err)).toContain('[REDACTED]')
    expect(formatLastError(err)).not.toContain('ya29.Access')
  })

  it('handles non-Error throwables', () => {
    expect(formatLastError('plain string error')).toBe('plain string error')
  })

  it('truncates to 240 chars', () => {
    const long = 'x'.repeat(500)
    expect(formatLastError(long).length).toBeLessThanOrEqual(241)
  })
})
