// Pure helpers that compute the diff between what the AI extracted and
// what the human (or auto-approver) ultimately approved, so we can write
// back new alias rows for next time. Vitest-friendly.

import { normalizeCompanyName, normalizeItemCode } from './normalize.ts'

export interface AliasDiffInput {
  /** What extract-po wrote into pending_pos.extracted_po. */
  extracted: {
    customer_name_raw: string | null
    lines: Array<{
      item_code_raw: string | null
      description_raw: string | null
    }>
  }
  /** What extract-po wrote into pending_pos.matched_horeca_id at first. */
  originallyMatchedHorecaId: number | null
  /** What extract-po wrote into pending_pos.matched_items at first. */
  originallyMatchedItems: Array<{
    po_line_index: number
    product_id: number | null
  }>
  /** The approved values (operator-corrected or extract-po's own auto-match). */
  approvedHorecaId: number
  approvedItems: Array<{
    po_line_index: number
    product_id: number
  }>
  /** Sender info from the inbound_messages row. */
  fromAddress: string | null
}

export interface NewCustomerAlias {
  source_type: 'sender_email' | 'sender_domain' | 'po_text'
  source_value: string
  horeca_id: number
}

export interface NewProductAlias {
  horeca_id: number
  source_code: string | null
  source_description: string | null
  product_id: number
}

export interface AliasDiffResult {
  customerAliases: NewCustomerAlias[]
  productAliases: NewProductAlias[]
}

/**
 * Compute alias rows that should be written so the same sender + items
 * resolve deterministically next time.
 *
 * Strategy:
 *   * Customer: always write the strongest possible alias for the
 *     sender (sender_email is best; falls back to sender_domain; finally
 *     po_text). The DB enforces uniqueness — a duplicate insert no-ops.
 *   * Product: per resolved line, write an alias keyed on whichever raw
 *     value was present (code preferred over description).
 *
 * Idempotency relies on the DB's UNIQUE indexes (00018 migration). Any
 * row this function returns may already exist; callers should attempt
 * the insert and treat unique-violation as a no-op.
 */
export function computeAliasDiff(input: AliasDiffInput): AliasDiffResult {
  const customerAliases = computeCustomerAliases(input)
  const productAliases = computeProductAliases(input)
  return { customerAliases, productAliases }
}

function computeCustomerAliases(input: AliasDiffInput): NewCustomerAlias[] {
  const out: NewCustomerAlias[] = []

  // The strongest signal we have is the sender email itself.
  const email = (input.fromAddress ?? '').trim().toLowerCase()
  if (email) {
    out.push({
      source_type: 'sender_email',
      source_value: email,
      horeca_id: input.approvedHorecaId,
    })
    // Also write the domain alias when the address has one. Two rows are
    // fine — UNIQUE(source_type, source_value) lets them coexist and the
    // resolver consults sender_email first.
    const at = email.lastIndexOf('@')
    if (at > 0 && at < email.length - 1) {
      const domain = email.slice(at + 1).replace(/^www\./, '')
      if (domain) {
        out.push({
          source_type: 'sender_domain',
          source_value: domain,
          horeca_id: input.approvedHorecaId,
        })
      }
    }
  }

  // If the PO printed a customer name, capture that too so future POs
  // from a different sender (e.g., a procurement aggregator forwarding
  // on behalf of the customer) still resolve.
  const poTextValue = normalizeCompanyName(input.extracted.customer_name_raw)
  if (poTextValue) {
    out.push({
      source_type: 'po_text',
      source_value: poTextValue,
      horeca_id: input.approvedHorecaId,
    })
  }

  return out
}

function computeProductAliases(input: AliasDiffInput): NewProductAlias[] {
  const out: NewProductAlias[] = []
  for (const approved of input.approvedItems) {
    const sourceLine = input.extracted.lines[approved.po_line_index]
    if (!sourceLine) continue

    const code = normalizeItemCode(sourceLine.item_code_raw)
    const desc = normalizeCompanyName(sourceLine.description_raw)
    if (!code && !desc) continue

    out.push({
      horeca_id: input.approvedHorecaId,
      source_code: code || null,
      source_description: desc || null,
      product_id: approved.product_id,
    })
  }
  return out
}
