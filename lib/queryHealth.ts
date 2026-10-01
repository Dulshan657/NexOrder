// Which of the app-level queries have failed, or are still on their first
// load. App.tsx defaults every list to `[]`, so without this a failed orders
// query rendered exactly like a business with no orders, and a failed
// catalogue like a search that matched nothing.

export interface QueryStateLike {
  isError: boolean
  isPending: boolean
  fetchStatus: 'fetching' | 'paused' | 'idle'
}

export interface DataStatus {
  /** Labels of queries whose last fetch failed. */
  failed: string[]
  /** Labels of queries with no data yet and a fetch under way. */
  loading: string[]
}

export function summariseQueries(entries: ReadonlyArray<{ label: string; query: QueryStateLike }>): DataStatus {
  const failed: string[] = []
  const loading: string[] = []
  for (const { label, query } of entries) {
    if (query.isError) failed.push(label)
    // Pending + idle is a DISABLED query (no data, not fetching): not loading.
    else if (query.isPending && query.fetchStatus !== 'idle') loading.push(label)
  }
  return { failed, loading }
}
