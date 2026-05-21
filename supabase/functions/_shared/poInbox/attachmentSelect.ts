// Attachment selection for extract-po.
//
// An inbound PO email often carries a real document (PDF / Word) AND an
// inline signature/logo image in the HTML body. The signature must never be
// chosen over the real PO. This module classifies each stored attachment and
// chooses a primary document with a deliberate precedence:
//
//   real PDF  →  real DOCX  →  real (non-signature) image  →  body/DOCX text
//   →  (last resort) a signature/inline image
//
// "Signature" detection is conservative and only ever demotes IMAGES — PDFs
// and DOCX are always treated as genuine PO documents. It works from filename,
// size, mime type, and the `inline` flag (Content-Disposition / Content-ID for
// Gmail, isInline for Graph), so it still helps on older archives that predate
// the inline flag (filename/size/gif signals alone catch most signatures).

export interface AttachmentMeta {
  /** In-bucket object name, e.g. "1-order.pdf". */
  storedName: string
  /** Original attachment filename (no {index}- prefix). */
  filename: string
  mimeType: string
  /** Size in bytes (0 when unknown). */
  size: number
  /** True for inline body parts (cid-referenced signatures/logos). */
  inline: boolean
}

export type DocKind = 'pdf' | 'docx' | 'image'

/** Images below this byte size are almost always signatures/logos/icons. */
const SMALL_IMAGE_BYTES = 50_000

// Matches common auto-generated signature/logo/icon image names. Tolerates the
// stored "{index}-" prefix so it works on both the raw filename and the
// stored object name.
const SIGNATURE_NAME = /^(?:\d+-)?(image|img|logo|sig|signature|icon|emoji|smiley|banner)[-_ ]?\d*\.(png|gif|jpe?g|webp|heic|bmp)$/i

export function attachmentKind(m: AttachmentMeta): DocKind | null {
  const mime = (m.mimeType ?? '').toLowerCase()
  const name = (m.filename ?? '').toLowerCase()
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword' ||
    name.endsWith('.docx') ||
    name.endsWith('.doc')
  ) {
    return 'docx'
  }
  if (mime.startsWith('image/') || /\.(jpe?g|png|webp|heic|gif|bmp)$/i.test(name)) return 'image'
  return null
}

export function isLikelySignature(m: AttachmentMeta): boolean {
  // Only images are ever treated as signatures; real documents are real.
  if (attachmentKind(m) !== 'image') return false
  if (m.inline) return true
  if ((m.mimeType ?? '').toLowerCase() === 'image/gif') return true
  if (m.size > 0 && m.size < SMALL_IMAGE_BYTES) return true
  if (SIGNATURE_NAME.test((m.filename ?? '').trim())) return true
  return false
}

export interface PrimarySelection {
  pdf?: AttachmentMeta
  docx?: AttachmentMeta
  /** First genuine (non-signature) image. */
  image?: AttachmentMeta
  /** First signature/inline image — used only as a last resort. */
  weakImage?: AttachmentMeta
}

/**
 * Classify a manifest of stored attachments into the first real PDF, the
 * first real DOCX, the first genuine image, and (separately) the first
 * signature/inline image. The caller decides the final primary by precedence
 * and falls back to `weakImage` only when there is no real document or text.
 */
export function selectAttachments(manifest: AttachmentMeta[]): PrimarySelection {
  const sel: PrimarySelection = {}
  for (const m of manifest) {
    const kind = attachmentKind(m)
    if (!kind) continue
    if (kind === 'pdf') {
      if (!sel.pdf) sel.pdf = m
    } else if (kind === 'docx') {
      if (!sel.docx) sel.docx = m
    } else {
      // image
      if (isLikelySignature(m)) {
        if (!sel.weakImage) sel.weakImage = m
      } else if (!sel.image) {
        sel.image = m
      }
    }
  }
  return sel
}
