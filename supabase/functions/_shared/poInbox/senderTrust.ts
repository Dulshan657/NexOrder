// Sender / customer mismatch detection for inbound POs (anti-spoofing).
//
// A PO whose document body identifies a known customer (e.g. by company
// name) but arrives from an address that does NOT belong to that customer
// is a spoofing / wrong-sender risk. We flag it so it can never
// auto-approve and is surfaced for human verification.
//
// "Trusted" is defined by EXACT email address (operator's chosen
// strictness): the HoReCa's curated contact_email plus every learned
// `sender_email` alias for that HoReCa. Domain-level (`sender_domain`)
// aliases are deliberately NOT treated as blanket trust — a new mailbox
// at an otherwise-known company still flags.
//
// The flag self-clears through the existing learning loop: on manual
// approve, approve-po's computeAliasDiff writes a `sender_email` alias for
// the exact sender, so the next PO from that address is trusted.

import { normalizeEmail } from './normalize.ts'
import type { SupabaseLike, SupabaseSelectBuilder } from './aliasResolver.ts'

export interface SenderMismatchResult {
  /** True when the customer is resolved but the sender isn't a trusted address. */
  flagged: boolean
  /** Normalized sender address (lower-cased), or null when absent. */
  sender: string | null
}

/**
 * Pure trust check. Normalizes both sides so casing/whitespace differences
 * never produce a false mismatch. A null/empty sender is never trusted
 * (we can't verify it). Exported for unit testing without a DB.
 */
export function isSenderTrusted(
  sender: string | null | undefined,
  trusted: Array<string | null | undefined>,
): boolean {
  const s = normalizeEmail(sender)
  if (!s) return false
  return trusted.some(t => normalizeEmail(t) === s)
}

/**
 * Build the trusted-exact address set for a HoReCa and decide whether the
 * inbound sender belongs to it. Two cheap reads (contact_email + the
 * customer's sender_email aliases). Only meaningful when a customer was
 * resolved — callers should skip this when horecaId is null.
 */
export async function detectSenderMismatch(input: {
  supa: SupabaseLike
  fromAddress: string | null
  horecaId: number
}): Promise<SenderMismatchResult> {
  const { supa, fromAddress, horecaId } = input
  const sender = normalizeEmail(fromAddress) || null

  const trusted = await buildTrustedSenders(supa, horecaId)
  return { flagged: !isSenderTrusted(sender, trusted), sender }
}

async function buildTrustedSenders(
  supa: SupabaseLike,
  horecaId: number,
): Promise<string[]> {
  const trusted: string[] = []

  // 1) The HoReCa's curated contact_email.
  const contact = await (supa
    .from('horecas')
    .select('contact_email') as unknown as SupabaseSelectBuilder<{ contact_email: string | null }>)
    .eq('id', horecaId)
    .maybeSingle()
  if (contact.error) {
    console.warn('[senderTrust] horecas.contact_email lookup failed:', contact.error.message)
  } else if (contact.data?.contact_email) {
    trusted.push(contact.data.contact_email)
  }

  // 2) Every learned sender_email alias for this HoReCa (exact addresses).
  const aliases = await (supa
    .from('po_customer_aliases')
    .select('source_value') as unknown as SupabaseSelectBuilder<{ source_value: string }>)
    .eq('horeca_id', horecaId)
    .eq('source_type', 'sender_email')
  if (aliases.error) {
    console.warn('[senderTrust] sender_email alias lookup failed:', aliases.error.message)
  } else {
    for (const row of aliases.data ?? []) {
      if (row.source_value) trusted.push(row.source_value)
    }
  }

  return trusted
}
