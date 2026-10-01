// Optimistic-update handlers for TanStack Query mutations.
//
// For edits that are frequent, rarely refused and easy to undo (a toggle, a
// "mark read", a dismiss): the cache changes the moment the user acts, every
// touched entry rolls back if the server refuses, and the prefix is refetched
// once the mutation settles so the server has the last word.
//
// NOT for anything the server validates in ways the client cannot predict —
// placing or cancelling an order, stock and ledger moves, invoice status.
// Those stay pessimistic: wait for the server, then update.

import type { QueryClient, QueryKey } from '@tanstack/react-query'

export interface OptimisticContext {
  snapshot: Array<[QueryKey, unknown]>
}

type PrefixOf<TVars> = QueryKey | ((vars: TVars) => QueryKey)

/**
 * `update` is applied to EVERY cached query under the prefix, so it must hand
 * back anything it does not recognise (a count, a single record) unchanged.
 * `patchRowById` / `removeRowById` below already do.
 *
 * Concurrent edits share `mutationKey` (defaults to a static prefix; required
 * when the prefix depends on the variables). While another edit is in flight,
 * a failure does not restore its snapshot (it predates that edit) and a
 * settle does not refetch (the server may not have the other write yet) —
 * the LAST one to settle refetches and the server has the final word.
 */
export function optimisticUpdate<TVars>(
  qc: QueryClient,
  prefix: PrefixOf<TVars>,
  update: (data: unknown, vars: TVars) => unknown,
  mutationKey: QueryKey = typeof prefix === 'function' ? ['optimistic'] : prefix,
) {
  const keyFor = (vars: TVars): QueryKey => (typeof prefix === 'function' ? prefix(vars) : prefix)
  const othersInFlight = () => qc.isMutating({ mutationKey, exact: true }) > 1

  return {
    mutationKey,
    onMutate: async (vars: TVars): Promise<OptimisticContext> => {
      const queryKey = keyFor(vars)
      // An in-flight fetch resolving after this write would overwrite it.
      await qc.cancelQueries({ queryKey })
      const snapshot = qc.getQueriesData<unknown>({ queryKey })
      qc.setQueriesData<unknown>({ queryKey }, (data) => (data === undefined ? data : update(data, vars)))
      return { snapshot }
    },
    // `Error`, not `unknown`: these parameters feed useMutation's inference of
    // TError, and `unknown` would erase `.message` at every caller.
    onError: (_error: Error, _vars: TVars, context: OptimisticContext | undefined) => {
      if (othersInFlight()) return
      for (const [key, data] of context?.snapshot ?? []) qc.setQueryData(key, data)
    },
    // `never` keeps this unused parameter out of useMutation's inference of
    // TData; `unknown` would erase the result type of mutateAsync.
    onSettled: (_data: never, _error: Error | null, vars: TVars) =>
      othersInFlight() ? undefined : qc.invalidateQueries({ queryKey: keyFor(vars) }),
  }
}

type Row = { id?: unknown }

/** Merge `patch` into the row with this id. Non-arrays, and arrays with no
 *  such row, come back as the same reference. */
export function patchRowById(
  data: unknown,
  id: unknown,
  patch: object | ((row: never) => object),
): unknown {
  if (!Array.isArray(data) || !data.some((row: Row) => row?.id === id)) return data
  return data.map((row: Row) =>
    row?.id === id ? { ...row, ...(typeof patch === 'function' ? patch(row as never) : patch) } : row,
  )
}

/** Drop the row with this id. Same reference-preserving rules as above. */
export function removeRowById(data: unknown, id: unknown): unknown {
  if (!Array.isArray(data) || !data.some((row: Row) => row?.id === id)) return data
  return data.filter((row: Row) => row?.id !== id)
}
