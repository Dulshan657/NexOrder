// Document-vs-customer name mismatch detection for inbound POs.
//
// The sibling check in senderTrust.ts answers "is this sender ALLOWED to order
// for customer X". This one answers the different question "is customer X who
// the DOCUMENT says it is" — and nothing asked it until now.
//
// The gap it closes: resolveCustomer consults the `sender_email` alias first,
// so once an address has been learned, every PO from it resolves to that
// customer no matter whose letterhead the PDF carries. detectSenderMismatch
// then cannot object, because its trusted set is built from those same
// sender_email aliases and is therefore a superset of the key that just did the
// resolving — structurally always trusted on that path. A PO printing
// "Hallidays Heating and Cooling Pty Ltd", emailed from an address learned for
// Executive Heating & Cooling, was booked against Executive in silence.
//
// Matching is deliberately LENIENT, because a false positive here blocks
// auto-approval for a legitimate customer:
//   * an absent document name never flags — it contradicts nothing;
//   * legal suffixes are stripped, so "Acme Pty Ltd" matches "Acme";
//   * containment counts either way, so neither side needs the fuller wording;
//   * any learned `po_text` alias for that customer counts as a match. Those
//     aliases ARE the customer's known trading names ("GPC Asia Pacific Pty
//     Ltd" for Repco), so reusing them is what keeps established customers off
//     this flag.
//
// The flag self-clears through the existing learning loop, exactly as
// sender_mismatch does: approve-po's computeAliasDiff writes a `po_text` alias
// from customer_name_raw on manual approval, so the next PO printing that name
// for that customer passes.

import { normalizeCompanyName } from './normalize.ts'
import type { SupabaseLike, SupabaseSelectBuilder } from './aliasResolver.ts'

export interface CustomerNameMismatchResult {
  /** True when the document names a company that isn't the resolved customer. */
  flagged: boolean
  /** The document's company name, verbatim, or null when absent. */
  documentName: string | null
  /** The resolved customer's name, or null when it couldn't be read. */
  matchedName: string | null
}

// Trailing legal-entity suffixes, matched after normalizeCompanyName has already
// lowercased and turned punctuation into spaces ("Pty. Ltd." -> "pty ltd").
// Applied repeatedly so "acme pty ltd" sheds both words. "co" and "company" are
// deliberately absent: they carry meaning in trading names often enough that
// stripping them would merge genuinely different businesses.
const LEGAL_SUFFIX = /\s+(pty|ltd|limited|inc|incorporated|llc|plc|p l)$/

// Standalone "and" is dropped because normalizeCompanyName turns "&" into a
// space but leaves the spelled-out word intact, so "Heating & Cooling" and
// "Heating and Cooling" would otherwise compare as different companies. The
// same firm's letterhead, invoices and customer record routinely disagree on
// which one they use, and that must never read as a mismatch.
const FILLER_WORD = /\band\b/g

/**
 * Normalize a company name for comparison: normalizeCompanyName, then fold the
 * ampersand/"and" difference away and shed any trailing legal-entity suffixes.
 *
 *   "Executive Heating & Cooling Pty Ltd"  ->  "executive heating cooling"
 *   "EXECUTIVE HEATING AND COOLING"        ->  "executive heating cooling"
 *
 * Exported for unit testing.
 */
export function normalizeForCompare(input: string | null | undefined): string {
  let name = normalizeCompanyName(input).replace(FILLER_WORD, ' ').replace(/\s+/g, ' ').trim()
  let previous = ''
  while (name !== previous) {
    previous = name
    name = name.replace(LEGAL_SUFFIX, '').trim()
  }
  return name
}

/**
 * Pure mismatch predicate. Returns true only when the document positively names
 * a DIFFERENT company from the resolved customer.
 *
 * `poTextAliases` are the raw stored `po_customer_aliases.source_value` rows of
 * type `po_text` for that customer; they are normalized here so a row written in
 * its printed form still counts.
 *
 * Exported for unit testing without a DB.
 */
export function isCustomerNameMismatch(
  documentName: string | null | undefined,
  customerName: string | null | undefined,
  poTextAliases: Array<string | null | undefined> = [],
): boolean {
  const doc = normalizeForCompare(documentName)
  // No name on the document (or nothing left after normalization) contradicts
  // nothing. Extraction misses this field routinely; treating that as a
  // mismatch would hold legitimate POs for review on an absence.
  if (!doc) return false

  const candidates = [customerName, ...poTextAliases]
    .map(normalizeForCompare)
    .filter(c => c.length > 0)
  // A customer we can't name can't be contradicted either.
  if (candidates.length === 0) return false

  return !candidates.some(c => c === doc || c.includes(doc) || doc.includes(c))
}

/**
 * Read the resolved customer's name plus its learned `po_text` aliases, and
 * decide whether the document contradicts them. Only meaningful once a customer
 * has been resolved — callers should skip this when horecaId is null.
 *
 * Both reads fail open (a lookup error leaves the flag off): this gate blocks
 * auto-approval, and a transient read error must not start holding every PO for
 * review.
 */
export async function detectCustomerNameMismatch(input: {
  supa: SupabaseLike
  extractedName: string | null
  horecaId: number
}): Promise<CustomerNameMismatchResult> {
  const { supa, extractedName, horecaId } = input
  const documentName = extractedName && extractedName.trim() ? extractedName.trim() : null

  const customer = await (supa
    .from('horecas')
    .select('name') as unknown as SupabaseSelectBuilder<{ name: string | null }>)
    .eq('id', horecaId)
    .maybeSingle()
  if (customer.error) {
    console.warn('[customerNameMatch] horecas.name lookup failed:', customer.error.message)
    return { flagged: false, documentName, matchedName: null }
  }
  const matchedName = customer.data?.name ?? null

  const aliases = await (supa
    .from('po_customer_aliases')
    .select('source_value') as unknown as SupabaseSelectBuilder<{ source_value: string }>)
    .eq('horeca_id', horecaId)
    .eq('source_type', 'po_text')
  if (aliases.error) {
    console.warn('[customerNameMatch] po_text alias lookup failed:', aliases.error.message)
    return { flagged: false, documentName, matchedName }
  }

  const poTextAliases = (aliases.data ?? []).map(row => row.source_value)
  return {
    flagged: isCustomerNameMismatch(documentName, matchedName, poTextAliases),
    documentName,
    matchedName,
  }
}
