import { useRef } from 'react'
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import {
  getPantryItems,
  upsertPantryItem,
  deletePantryItem,
} from '@/services/supabase/pantryService'
import type { Database } from '@/lib/database.types'
import { upsertPantryRow, removePantryRow, type PantryCacheRow } from '@/lib/pantryCache'

type PantryItemInsert = Database['public']['Tables']['pantry_items']['Insert']

export const pantryKeys = {
  all: ['pantry'] as const,
  byHoReCa: (horecaId: number) => ['pantry', horecaId] as const,
} as const

export function usePantryItems(horecaId: number | null | undefined) {
  return useQuery({
    queryKey: pantryKeys.byHoReCa(horecaId ?? 0),
    queryFn: () => getPantryItems(horecaId!),
    enabled: !!horecaId,
  })
}

// Pantry edits are frequent, low-risk and easy to undo, so they are
// OPTIMISTIC: the cache changes on click, rolls back if the server refuses,
// and is reconciled with one refetch once the last pending edit settles.
//
// Every pantry write shares one mutation `scope`, so TanStack sends them one
// at a time in click order (onMutate still runs at once, so the screen does
// not wait). Without it, two absolute-quantity upserts sent together could
// land out of order and leave the older value on the server.

type Snapshot = { previous: PantryCacheRow[] | undefined }

const PANTRY_SCOPE = { id: 'pantry' }

async function writeOptimistically(
  qc: QueryClient,
  horecaId: number,
  update: (rows: PantryCacheRow[]) => PantryCacheRow[],
): Promise<Snapshot> {
  const key = pantryKeys.byHoReCa(horecaId)
  await qc.cancelQueries({ queryKey: key })
  const previous = qc.getQueryData<PantryCacheRow[]>(key)
  qc.setQueryData<PantryCacheRow[]>(key, (rows) => update(rows ?? []))
  return { previous }
}

/** Restore the snapshot only when no newer edit is queued: each snapshot
 *  includes the earlier optimistic edits, so restoring one under a queued
 *  edit would hide that edit until the final refetch. With edits queued,
 *  the last one's reconcile() refetch shows the server's truth instead. */
function rollback(qc: QueryClient, horecaId: number, snapshot: Snapshot | undefined) {
  if (!snapshot || qc.isMutating({ mutationKey: pantryKeys.all }) > 1) return
  qc.setQueryData(pantryKeys.byHoReCa(horecaId), snapshot.previous)
}

export interface PantryWriteOptions {
  /** Called for EVERY failed write. Per-call mutate() callbacks fire only for
   *  the latest call on a hook, so a failure in a queued edit would be silent. */
  onWriteError?: (error: Error, target: { horecaId: number; productId: number }) => void
}

function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

/** Refetch only once the queue of pantry edits has drained; a refetch
 *  between two queued edits would briefly show the older server value. */
function reconcile(qc: QueryClient, horecaId: number) {
  if (qc.isMutating({ mutationKey: pantryKeys.all }) <= 1) {
    qc.invalidateQueries({ queryKey: pantryKeys.byHoReCa(horecaId) })
  }
}

export function useUpsertPantryItem({ onWriteError }: PantryWriteOptions = {}) {
  const qc = useQueryClient()
  const onWriteErrorRef = useLatest(onWriteError)
  return useMutation<unknown, Error, PantryItemInsert, Snapshot>({
    mutationKey: pantryKeys.all,
    scope: PANTRY_SCOPE,
    mutationFn: (item) => upsertPantryItem(item),
    onMutate: (item) =>
      writeOptimistically(qc, item.horeca_id, (rows) =>
        upsertPantryRow(rows, {
          horeca_id: item.horeca_id,
          product_id: item.product_id,
          preferred_pack_size: item.preferred_pack_size ?? null,
          default_quantity: item.default_quantity ?? 1,
        }),
      ),
    onError: (err, item, snapshot) => {
      rollback(qc, item.horeca_id, snapshot)
      onWriteErrorRef.current?.(err, { horecaId: item.horeca_id, productId: item.product_id })
    },
    onSettled: (_data, _err, item) => reconcile(qc, item.horeca_id),
  })
}

export function useDeletePantryItem({ onWriteError }: PantryWriteOptions = {}) {
  const qc = useQueryClient()
  const onWriteErrorRef = useLatest(onWriteError)
  return useMutation<unknown, Error, { horecaId: number; productId: number }, Snapshot>({
    mutationKey: pantryKeys.all,
    scope: PANTRY_SCOPE,
    mutationFn: ({ horecaId, productId }) => deletePantryItem(horecaId, productId),
    onMutate: ({ horecaId, productId }) =>
      writeOptimistically(qc, horecaId, (rows) => removePantryRow(rows, productId)),
    onError: (err, { horecaId, productId }, snapshot) => {
      rollback(qc, horecaId, snapshot)
      onWriteErrorRef.current?.(err, { horecaId, productId })
    },
    onSettled: (_data, _err, { horecaId }) => reconcile(qc, horecaId),
  })
}
