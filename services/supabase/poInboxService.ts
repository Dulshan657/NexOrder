// Frontend service for the PO Inbox feature.
//
// Reads are direct (RLS already restricts pending_pos, inbound_messages,
// po_*_aliases to Admin/Manager SELECT). Writes route through the
// approve-po / reject-po Edge Functions. Document downloads go through
// create-po-document-url which returns a short-lived signed URL.

import { supabase } from '@/lib/supabase'

export type PendingPoStatus = 'needs_review' | 'approved' | 'rejected' | 'auto_approved'

export interface PendingPoSummaryRow {
  id: string
  status: PendingPoStatus
  inbound_message_id: string
  matched_horeca_id: number | null
  confidence_overall: number
  approved_order_id: string | null
  reviewed_at: string | null
  created_at: string
  // Joined from inbound_messages
  from_address: string
  subject: string | null
  received_at: string
  storage_path_prefix: string
}

export interface PendingPoDetailRow extends PendingPoSummaryRow {
  extracted_po: ExtractedPoShape
  matched_items: MatchedItem[]
  confidence_fields: Record<string, unknown>
  rejection_reason: string | null
}

export interface MatchedItem {
  po_line_index: number
  product_id: number | null
  quantity: number
  pack_size: number | null
  confidence: number
}

export interface ExtractedPoLine {
  line_no: number
  item_code_raw: string | null
  description_raw: string | null
  quantity: number
  uom: string | null
  pack_size_raw: number | null
  notes: string | null
}

export interface ExtractedPoShape {
  po_number: string | null
  customer_name_raw: string | null
  customer_id_guess: string | null
  order_date: string | null
  requested_date: string | null
  ship_to: { name: string | null; street: string | null; city: string | null } | null
  lines: ExtractedPoLine[]
  source?: {
    channel: string
    format: 'pdf' | 'docx' | 'text' | 'image'
    original_filename: string | null
    message_id: string
    received_at: string
  }
}

const SUMMARY_SELECT = `
  id, status, inbound_message_id, matched_horeca_id, confidence_overall,
  approved_order_id, reviewed_at, created_at,
  inbound_messages:inbound_message_id (
    from_address, subject, received_at, storage_path_prefix
  )
`.trim()

const DETAIL_SELECT = `
  id, status, inbound_message_id, matched_horeca_id, matched_items,
  extracted_po, confidence_overall, confidence_fields, approved_order_id,
  reviewed_at, rejection_reason, created_at,
  inbound_messages:inbound_message_id (
    from_address, subject, received_at, storage_path_prefix
  )
`.trim()

type JoinedInbound = {
  from_address: string
  subject: string | null
  received_at: string
  storage_path_prefix: string
}

type SummaryRow = Omit<PendingPoSummaryRow, 'from_address' | 'subject' | 'received_at' | 'storage_path_prefix'> & {
  inbound_messages: JoinedInbound | null
}

type DetailRow = Omit<PendingPoDetailRow, 'from_address' | 'subject' | 'received_at' | 'storage_path_prefix'> & {
  inbound_messages: JoinedInbound | null
}

function flattenSummary(row: SummaryRow): PendingPoSummaryRow {
  const inbound = row.inbound_messages ?? {
    from_address: '',
    subject: null,
    received_at: row.created_at,
    storage_path_prefix: '',
  }
  return {
    id: row.id,
    status: row.status,
    inbound_message_id: row.inbound_message_id,
    matched_horeca_id: row.matched_horeca_id,
    confidence_overall: Number(row.confidence_overall),
    approved_order_id: row.approved_order_id,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    from_address: inbound.from_address,
    subject: inbound.subject,
    received_at: inbound.received_at,
    storage_path_prefix: inbound.storage_path_prefix,
  }
}

export async function listPendingPos(status?: PendingPoStatus): Promise<PendingPoSummaryRow[]> {
  let query = supabase
    .from('pending_pos')
    .select(SUMMARY_SELECT)
    .order('created_at', { ascending: false })
    .limit(200)
  if (status) {
    query = query.eq('status', status)
  }
  const { data, error } = await query
  if (error) throw new Error(`listPendingPos: ${error.message}`)
  return ((data ?? []) as unknown as SummaryRow[]).map(flattenSummary)
}

export async function countPendingPosNeedsReview(): Promise<number> {
  const { count, error } = await supabase
    .from('pending_pos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'needs_review')
  if (error) {
    // Not fatal — the header badge can show 0 rather than break the UI.
    // Caller has no way to surface it; silent best-effort is correct here.
    return 0
  }
  return count ?? 0
}

export async function getPendingPoDetail(id: string): Promise<PendingPoDetailRow> {
  const { data, error } = await supabase
    .from('pending_pos')
    .select(DETAIL_SELECT)
    .eq('id', id)
    .single()
  if (error || !data) throw new Error(`getPendingPoDetail: ${error?.message ?? 'not found'}`)
  const row = data as unknown as DetailRow
  const inbound = row.inbound_messages ?? {
    from_address: '',
    subject: null,
    received_at: row.created_at,
    storage_path_prefix: '',
  }
  return {
    id: row.id,
    status: row.status,
    inbound_message_id: row.inbound_message_id,
    matched_horeca_id: row.matched_horeca_id,
    matched_items: row.matched_items ?? [],
    extracted_po: row.extracted_po,
    confidence_overall: Number(row.confidence_overall),
    confidence_fields: row.confidence_fields ?? {},
    approved_order_id: row.approved_order_id,
    reviewed_at: row.reviewed_at,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    from_address: inbound.from_address,
    subject: inbound.subject,
    received_at: inbound.received_at,
    storage_path_prefix: inbound.storage_path_prefix,
  }
}

export interface ApproveOverrides {
  horecaId?: number
  items?: Array<{ po_line_index: number; product_id: number; quantity: number; pack_size?: number | null }>
  notes?: string | null
  deliveryDate?: string | null
  deliveryTimeSlot?: 'Morning (8am-12pm)' | 'Afternoon (12pm-4pm)' | 'Evening (4pm-8pm)' | null
}

export interface ApprovePoResponse {
  ok: true
  orderId?: string | null
  status?: 'approved' | 'auto_approved'
  aliasesWritten?: number
  alreadyApproved?: boolean
}

export async function approvePo(
  pendingPoId: string,
  overrides: ApproveOverrides = {},
): Promise<ApprovePoResponse> {
  const { data, error } = await supabase.functions.invoke('approve-po', {
    body: {
      pendingPoId,
      mode: 'human',
      overrideHorecaId: overrides.horecaId,
      overrideItems: overrides.items,
      overrideNotes: overrides.notes,
      overrideDeliveryDate: overrides.deliveryDate,
      overrideDeliveryTimeSlot: overrides.deliveryTimeSlot,
    },
  })
  if (error) throw new Error(`approvePo: ${error.message}`)
  throwOnStructuredError(data, 'approve-po failed')
  return data as ApprovePoResponse
}

export async function rejectPo(pendingPoId: string, rejectionReason: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('reject-po', {
    body: { pendingPoId, rejectionReason },
  })
  if (error) throw new Error(`rejectPo: ${error.message}`)
  throwOnStructuredError(data, 'reject-po failed')
}

export interface SignedUrlResult {
  signedUrl: string
  expiresInSeconds: number
}

export interface PoDocumentRef {
  pendingPoId: string
  kind: 'original' | 'attachment'
  attachmentIndex?: number
}

export async function getPoDocumentUrl(ref: PoDocumentRef): Promise<SignedUrlResult> {
  const { data, error } = await supabase.functions.invoke('create-po-document-url', {
    body: ref,
  })
  if (error) throw new Error(`getPoDocumentUrl: ${error.message}`)
  throwOnStructuredError(data, 'create-po-document-url failed')
  return data as SignedUrlResult
}

export interface CustomerAliasRow {
  id: string
  source_type: 'sender_email' | 'sender_domain' | 'po_text'
  source_value: string
  horeca_id: number
  confidence_at_creation: number | null
  created_by: string | null
  created_at: string
}

export interface ProductAliasRow {
  id: string
  horeca_id: number
  source_code: string | null
  source_description: string | null
  product_id: number
  default_pack_size: number | null
  confidence_at_creation: number | null
  created_by: string | null
  created_at: string
}

export async function listCustomerAliases(): Promise<CustomerAliasRow[]> {
  const { data, error } = await supabase
    .from('po_customer_aliases')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw new Error(`listCustomerAliases: ${error.message}`)
  return (data ?? []) as unknown as CustomerAliasRow[]
}

export async function listProductAliases(): Promise<ProductAliasRow[]> {
  const { data, error } = await supabase
    .from('po_product_aliases')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw new Error(`listProductAliases: ${error.message}`)
  return (data ?? []) as unknown as ProductAliasRow[]
}

// supabase.functions.invoke only surfaces HTTP errors via its `error`
// return. When an Edge Function returns HTTP 200 with a structured
// `{ error: { code, message } }` body — which our Edge Functions do
// for caller-error 4xx cases routed through errorResponse — the body
// arrives in `data`. This helper detects that shape and rethrows so
// the UI's onError path fires. Do not remove without auditing every
// caller in this file.
function throwOnStructuredError(data: unknown, fallback: string): void {
  if (
    data &&
    typeof data === 'object' &&
    'error' in data &&
    data.error &&
    typeof (data as { error: { message?: unknown; code?: unknown } }).error === 'object'
  ) {
    const err = (data as { error: { message?: string; code?: string } }).error
    throw new Error(err.message ?? err.code ?? fallback)
  }
}
