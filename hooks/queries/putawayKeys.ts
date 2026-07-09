// Query-key factory for putaway-queue reads, mirroring inventoryKeys
// (hooks/queries/useInventoryBalances.ts). Every mutation that can generate or
// action a putaway task (receive/adjust/transfer-stock, decide-putaway) must
// invalidate `all` (and `counts`, for the picker default + nav badge) so the
// queue never serves a stale empty array — that was the root cause fixed here:
// the key was written once (PutawayQueueView) and invalidated nowhere.
export const putawayKeys = {
  all: ['putaway-queue'] as const,
  byWarehouse: (id: number) => ['putaway-queue', id] as const,
  counts: ['putaway-counts'] as const,
} as const
