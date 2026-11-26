// New Order drafts (`order_drafts`, mig 00148). Reads go straight to PostgREST
// (RLS: Admin/Manager); writes go through `mutate-order-draft`.

import { supabase } from '@/lib/supabase'
import { extractFunctionErrorMessage } from '@/lib/functionError'
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
  hoReCaId: number | null
  lines: DraftLine[]
  deliveryDate: string | null
  notes: string | null
}

export async function saveOrderDraft(input: SaveOrderDraftInput): Promise<{ id: string }> {
  const { data, error } = await supabase.functions.invoke<{ ok: true; draft: { id: string } }>('mutate-order-draft', {
    body: { action: 'upsert', ...input },
  })
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'The draft could not be saved'))
  if (!data?.draft?.id) throw new Error('Saving the draft returned no draft')
  return { id: data.draft.id }
}

export async function deleteOrderDraft(id: string): Promise<void> {
  const { error } = await supabase.functions.invoke('mutate-order-draft', { body: { action: 'delete', id } })
  if (error) throw new Error(await extractFunctionErrorMessage(error, 'The draft could not be deleted'))
}
