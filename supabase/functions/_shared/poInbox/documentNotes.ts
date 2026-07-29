// The two whole-document text blocks a PO can carry — "Notes" and "Delivery
// Instructions" — and how they become the single `orders.notes` column.
//
// Deliberately dependency-free, like ./extractionSchema.ts, so the same file
// serves both runtimes: Deno inside approve-po, and Vite/vitest on the frontend
// where the detail modal renders the blocks. Forking this would let the text an
// operator reads diverge from the text the picker is handed.

/** One of the blocks as extracted. Loose on purpose: rows written before these
 *  fields shipped simply lack the keys, which arrives as `undefined`. */
export interface DocumentNotesSource {
  notes?: string | null
  delivery_instructions?: string | null
}

/**
 * Normalise one block for display or storage.
 *
 * Four inputs all mean "no block" and must collapse to one: the key is absent
 * (a row extracted before this shipped), the model returned null (no such block
 * on the page), the model returned an empty string, or the document printed the
 * heading with nothing under it. Extracted values also carry surrounding
 * whitespace, since the heading and its text sit on separate lines.
 */
export function documentNoteText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Heading used when both blocks are present and have to share one column. */
const DELIVERY_HEADING = 'Delivery instructions:'

/**
 * Fold the PO's printed blocks into the single `orders.notes` text column.
 *
 * Labelled only when both are present — a lone block reads better as bare text,
 * and the common case ("Don't deliver outdoor unit as it will be called up at a
 * later date") is exactly that. Returns null when the document carried neither,
 * so callers can leave `orders.notes` null rather than writing an empty string.
 */
export function composeOrderNotes(extracted: DocumentNotesSource | null | undefined): string | null {
  const notes = documentNoteText(extracted?.notes)
  const delivery = documentNoteText(extracted?.delivery_instructions)

  if (notes && delivery) return `${notes}\n\n${DELIVERY_HEADING}\n${delivery}`
  if (notes) return notes
  if (delivery) return `${DELIVERY_HEADING}\n${delivery}`
  return null
}
