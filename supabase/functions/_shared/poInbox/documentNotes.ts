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
  /** Not a text block like the other two — a labelled field (see
   *  extractionSchema.ts). It rides along here because `orders.notes` is the
   *  only channel the printed document has to the person picking the order,
   *  and "which site is this for?" is the question they ask next. */
  job_address?: string | null
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

/** Headings for the blocks that are never safe to print bare. */
const DELIVERY_HEADING = 'Delivery instructions:'
const JOB_ADDRESS_HEADING = 'Job address:'

/**
 * Fold the PO's printed blocks into the single `orders.notes` text column.
 *
 * One rule decides the labelling: `notes` is the document's general remark and
 * reads fine as bare text — the common case ("Don't deliver outdoor unit as it
 * will be called up at a later date") is exactly that — while the others are
 * meaningless without their heading. A bare "Lot 21/21 Coomleigh Avenue" in the
 * middle of a picking note is worse than no note at all. So `notes` leads,
 * unlabelled, and every other block follows under its own heading.
 *
 * Returns null when the document carried none of them, so callers can leave
 * `orders.notes` null rather than writing an empty string.
 */
export function composeOrderNotes(extracted: DocumentNotesSource | null | undefined): string | null {
  const notes = documentNoteText(extracted?.notes)
  const delivery = documentNoteText(extracted?.delivery_instructions)
  const jobAddress = documentNoteText(extracted?.job_address)

  const sections: string[] = []
  if (notes) sections.push(notes)
  if (delivery) sections.push(`${DELIVERY_HEADING}\n${delivery}`)
  if (jobAddress) sections.push(`${JOB_ADDRESS_HEADING}\n${jobAddress}`)

  return sections.length > 0 ? sections.join('\n\n') : null
}
