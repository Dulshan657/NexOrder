// Read a whole list past PostgREST's row cap.
//
// The API answers at most `max_rows` rows per request (1000, Supabase's
// default; supabase/config.toml does not override it) and says nothing when it
// truncates. The app-level lists were single unbounded selects, so the order
// list would have stopped at 1000 orders and every dashboard computed from it
// would have under-reported without an error.
//
// Pages until a SHORT page, so a list under the cap still costs one request.
// The page size must not exceed the server's cap, or a full capped page would
// read as short and end the walk early. The query MUST be ordered by a unique
// key (add `id` as a tiebreaker), or rows can repeat or vanish between pages.
// Rows carrying an `id` are de-duplicated: a live insert ahead of the window
// shifts the next page by one, repeating the row at the boundary.

export const ROW_CAP = 1000

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>

export async function fetchAllRows<T>(page: (from: number, to: number) => Page<T>, pageSize = ROW_CAP): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1)
    if (error) throw error
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) return dedupeById(rows)
  }
}

function dedupeById<T>(rows: T[]): T[] {
  const seen = new Set<unknown>()
  return rows.filter((row) => {
    const id = (row as { id?: unknown } | null)?.id
    if (id === undefined) return true
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}
