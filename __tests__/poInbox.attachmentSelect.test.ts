import { describe, it, expect } from 'vitest'

import {
  attachmentKind,
  isLikelySignature,
  selectAttachments,
  type AttachmentMeta,
} from '../supabase/functions/_shared/poInbox/attachmentSelect'

function att(over: Partial<AttachmentMeta>): AttachmentMeta {
  return {
    storedName: '0-file',
    filename: 'file',
    mimeType: 'application/octet-stream',
    size: 100_000,
    inline: false,
    ...over,
  }
}

const PDF = att({ storedName: '1-order.pdf', filename: 'order.pdf', mimeType: 'application/pdf', size: 250_000 })
const DOCX = att({
  storedName: '1-order.docx',
  filename: 'order.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: 90_000,
})
const REAL_IMAGE = att({ storedName: '1-scan.jpg', filename: 'scan.jpg', mimeType: 'image/jpeg', size: 800_000 })
const SIG_INLINE = att({ storedName: '0-image001.png', filename: 'image001.png', mimeType: 'image/png', size: 4_000, inline: true })

describe('attachmentKind', () => {
  it('classifies by mime type and filename extension', () => {
    expect(attachmentKind(PDF)).toBe('pdf')
    expect(attachmentKind(DOCX)).toBe('docx')
    expect(attachmentKind(REAL_IMAGE)).toBe('image')
    expect(attachmentKind(att({ filename: '0-notes.txt', mimeType: 'text/plain' }))).toBeNull()
  })
})

describe('isLikelySignature', () => {
  it('never flags pdf or docx (only images can be signatures)', () => {
    expect(isLikelySignature(PDF)).toBe(false)
    expect(isLikelySignature(DOCX)).toBe(false)
  })

  it('flags inline images', () => {
    expect(isLikelySignature(att({ filename: 'whatever.png', mimeType: 'image/png', size: 999_999, inline: true }))).toBe(true)
  })

  it('flags tiny images (typical signature/logo size)', () => {
    expect(isLikelySignature(att({ filename: 'pic.png', mimeType: 'image/png', size: 3_000 }))).toBe(true)
  })

  it('flags GIFs (almost never a scanned PO)', () => {
    expect(isLikelySignature(att({ filename: 'spacer.gif', mimeType: 'image/gif', size: 500_000 }))).toBe(true)
  })

  it('flags signature-ish filenames even with the stored {index}- prefix', () => {
    expect(isLikelySignature(att({ filename: 'image001.png', mimeType: 'image/png', size: 500_000 }))).toBe(true)
    expect(isLikelySignature(att({ storedName: '0-logo.png', filename: '0-logo.png', mimeType: 'image/png', size: 500_000 }))).toBe(true)
  })

  it('does NOT flag a genuine large, well-named, non-inline scan', () => {
    expect(isLikelySignature(REAL_IMAGE)).toBe(false)
  })
})

describe('selectAttachments', () => {
  it('prefers a real PDF over an inline signature', () => {
    const sel = selectAttachments([SIG_INLINE, PDF])
    expect(sel.pdf).toEqual(PDF)
    expect(sel.image).toBeUndefined()
    expect(sel.weakImage).toEqual(SIG_INLINE)
  })

  it('prefers a DOCX over an inline signature (no image is selected)', () => {
    const sel = selectAttachments([SIG_INLINE, DOCX])
    expect(sel.docx).toEqual(DOCX)
    expect(sel.image).toBeUndefined()
    expect(sel.pdf).toBeUndefined()
    expect(sel.weakImage).toEqual(SIG_INLINE)
  })

  it('picks a genuine image PO over a signature image', () => {
    const sel = selectAttachments([SIG_INLINE, REAL_IMAGE])
    expect(sel.image).toEqual(REAL_IMAGE)
    expect(sel.weakImage).toEqual(SIG_INLINE)
  })

  it('falls back to the signature only when nothing else exists', () => {
    const sel = selectAttachments([SIG_INLINE])
    expect(sel.pdf).toBeUndefined()
    expect(sel.docx).toBeUndefined()
    expect(sel.image).toBeUndefined()
    expect(sel.weakImage).toEqual(SIG_INLINE)
  })

  it('takes the first of each real kind and ignores unprocessable parts', () => {
    const sel = selectAttachments([att({ filename: '0-notes.txt', mimeType: 'text/plain' }), PDF, REAL_IMAGE])
    expect(sel.pdf).toEqual(PDF)
    expect(sel.image).toEqual(REAL_IMAGE)
  })
})
