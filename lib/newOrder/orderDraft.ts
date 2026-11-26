// A saved New Order draft as the screen sees it (camelCase), and the adapter
// from its `order_drafts` row. Drafts are shared: any Admin or Manager can open
// and finish one somebody else started, which is why the author is carried.

import type { DraftLine } from './orderLineModel'

export interface OrderDraft {
  id: string
  hoReCaId: number | null
  lines: DraftLine[]
  deliveryDate: string | null
  notes: string | null
  createdBy: string
  createdByName?: string
  /** null once the last editor's login has been deleted. */
  updatedBy: string | null
  updatedByName?: string
  createdAt: string
  updatedAt: string
}

export interface OrderDraftRow {
  id: string
  horeca_id: number | null
  lines: unknown
  delivery_date: string | null
  notes: string | null
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
  creator?: { name: string | null } | null
  updater?: { name: string | null } | null
}

const toLine = (raw: unknown): DraftLine | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.productId !== 'number' || typeof r.quantity !== 'number') return null
  return { productId: r.productId, uomId: typeof r.uomId === 'number' ? r.uomId : null, quantity: r.quantity }
}

/** Row → draft. A malformed stored line is dropped rather than crashing the list. */
export function toOrderDraft(row: OrderDraftRow): OrderDraft {
  const lines = Array.isArray(row.lines) ? row.lines.map(toLine).filter((l): l is DraftLine => l !== null) : []
  return {
    id: row.id,
    hoReCaId: row.horeca_id,
    lines,
    deliveryDate: row.delivery_date,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.creator?.name ?? undefined,
    updatedBy: row.updated_by,
    updatedByName: row.updater?.name ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** A draft worth keeping: something has been chosen or typed. */
export const isDraftWorthSaving = (d: Pick<OrderDraft, 'hoReCaId' | 'lines' | 'deliveryDate' | 'notes'>) =>
  d.hoReCaId !== null || d.lines.length > 0 || (d.deliveryDate ?? '') !== '' || (d.notes ?? '').trim() !== ''
