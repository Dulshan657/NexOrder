// New Order drafts (`order_drafts`, mig 00150). Reads go straight to PostgREST
// (RLS: Admin/Manager); writes go through `mutate-order-draft`.

import { supabase } from '@/lib/supabase'
import { extractFunctionErrorEnvelope, extractFunctionErrorMessage } from '@/lib/functionError'
import { toOrderDraft, type OrderDraft, type OrderDraftRow } from '@/lib/newOrder/orderDraft'
import type { DraftLine } from '@/lib/newOrder/orderLineModel'

const DRAFT_SELECT =
  'id, horeca_id, lines, delivery_date, notes, created_by, updated_by, created_at, updated_at,' +
  ' creator:profiles!order_drafts_created_by_fkey(name), updater:profiles!order_drafts_updated_by_fkey(name)'

/** More than the office keeps open at once; the list is newest-first. */
const DRAFT_LIST_LIMIT = 100

export async function listOrderDrafts(): Promise<OrderDraft[]> {
  const { data, error } = await supabase
    .from('order_drafts')
    .select(DRAFT_SELECT)
    .order('updated_at', { ascending: false })
    .limit(DRAFT_LIST_LIMIT)
  if (error) throw new Error(`Could not load drafts: ${error.message}`)
  return ((data ?? []) as unknown as OrderDraftRow[]).map(toOrderDraft)
}

export interface SaveOrderDraftInput {
  /** null creates a draft. */
  id: string | null
  /** The draft's `updated_at` as last seen; an update applies only if it still matches. */
  expectedUpdatedAt: string | null
  hoReCaId: number | null
  lines: DraftLine[]
  deliveryDate: string | null
  notes: string | null
}

/** A failed save, carrying the server's code so the caller can branch on it:
 *  `NOT_FOUND` (placed or deleted meanwhile) and `CONFLICT` (edited by someone
 *  else) are both recoverable by saving as a new draft. */
export class DraftSaveError extends Error {
  readonly code: string | null
  constructor(message: string, code: string | null) {
    super(message)
    this.name = 'DraftSaveError'
    this.code = code
  }
}

export interface SavedDraft {
  id: string
  updatedAt: string
}

export async function saveOrderDraft(input: SaveOrderDraftInput): Promise<SavedDraft> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; draft: { id: string; updated_at: string } }>(
    'mutate-order-draft',
    { body: { action: 'upsert', ...input } },
  )
  if (error) {
    const envelope = await extractFunctionErrorEnvelope(error)
    throw new DraftSaveError(await extractFunctionErrorMessage(error, 'The draft could not be saved'), envelope?.code ?? null)
  }
  if (!data?.draft?.id) throw new DraftSaveError('Saving the draft returned no draft', null)
  return { id: data.draft.id, updatedAt: data.draft.updated_at }
}

export async function deleteOrderDraft(id: string): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-order-draft', { body: { action: 'delete', id } })
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'The draft could not be deleted'))
}
