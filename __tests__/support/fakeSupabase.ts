// In-memory fake of the `SupabaseLike` surface the PO-inbox resolvers use.
//
// The resolvers (`resolveCustomer`, `resolveProduct`, `detectSenderMismatch`,
// `backfillAliasOrigin`) take an injected `SupabaseLike` (aliasResolver.ts).
// This fake models just the PostgREST query-builder shape they exercise:
//
//   from(table).select(cols).eq().eq()...        -> awaitable list result
//                                  .maybeSingle() -> single-row result
//   from(table).select(cols).order().limit()     -> awaitable list result
//   from(table).insert(row).select()             -> { data: [{ id }], error }
//   from(table).update(patch).eq(col, val)       -> { error }
//
// `.eq()` predicates are accumulated and applied with stringwise equality so
// numeric ids and their string forms compare equal (robust for a test double).
// Inserts append to the backing table (so a later read in the same call would
// see them) and are recorded; updates are recorded with their eq filters.
// Error modes let a test simulate a failed lookup / insert / update.

import type {
  SupabaseLike,
} from '../../supabase/functions/_shared/poInbox/aliasResolver'
import type { AuditWriter } from '../../supabase/functions/_shared/poInbox/openai'

type Row = Record<string, unknown>

interface DbError {
  message: string
}

interface ListResult {
  data: Row[] | null
  error: DbError | null
}

export interface InsertedRecord {
  table: string
  row: Row
}

export interface UpdateRecord {
  table: string
  patch: Row
  eq: { column: string; value: string | number }
}

export interface FakeSupabaseOptions {
  /** Seed rows keyed by table name. */
  tables?: Record<string, Row[]>
  /** Per-table message to fail SELECTs with (simulates a read error). */
  selectErrors?: Record<string, string>
  /** Per-table message to fail INSERTs with (simulates a unique-constraint race). */
  insertErrors?: Record<string, string>
  /** Per-table message to fail UPDATEs with. */
  updateErrors?: Record<string, string>
}

interface Predicate {
  column: string
  value: string | number
}

function eqValue(a: unknown, b: string | number): boolean {
  if (a === null || a === undefined) return false
  return String(a) === String(b)
}

class FakeSelectBuilder {
  private readonly predicates: Predicate[] = []
  private orderColumn: string | null = null
  private orderAscending = true
  private limitN: number | null = null

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  eq(column: string, value: string | number): FakeSelectBuilder {
    this.predicates.push({ column, value })
    return this
  }

  order(column: string, options?: { ascending?: boolean }): FakeSelectBuilder {
    this.orderColumn = column
    this.orderAscending = options?.ascending ?? true
    return this
  }

  limit(n: number): FakeSelectBuilder {
    this.limitN = n
    return this
  }

  private resolveList(): ListResult {
    const errorMessage = this.db.selectErrors[this.table]
    if (errorMessage) return { data: null, error: { message: errorMessage } }

    let rows = (this.db.tables[this.table] ?? []).filter(row =>
      this.predicates.every(p => eqValue(row[p.column], p.value)),
    )

    if (this.orderColumn) {
      const col = this.orderColumn
      const dir = this.orderAscending ? 1 : -1
      rows = [...rows].sort((a, b) => {
        const av = String(a[col] ?? '')
        const bv = String(b[col] ?? '')
        return av < bv ? -dir : av > bv ? dir : 0
      })
    }

    if (this.limitN !== null) rows = rows.slice(0, this.limitN)
    return { data: rows, error: null }
  }

  async maybeSingle(): Promise<{ data: Row | null; error: DbError | null }> {
    const { data, error } = this.resolveList()
    if (error) return { data: null, error }
    return { data: data && data.length > 0 ? data[0] : null, error: null }
  }

  // Thenable: `await builder` resolves to the list result.
  then<TResolved>(
    onfulfilled: (value: ListResult) => TResolved,
    onrejected?: (reason: unknown) => TResolved,
  ): Promise<TResolved> {
    return Promise.resolve(this.resolveList()).then(onfulfilled, onrejected)
  }
}

/**
 * In-memory `SupabaseLike` test double. Use {@link makeFakeSupabase} to get a
 * value typed as `SupabaseLike` together with the recorders.
 */
export class FakeSupabase {
  readonly tables: Record<string, Row[]>
  readonly selectErrors: Record<string, string>
  readonly insertErrors: Record<string, string>
  readonly updateErrors: Record<string, string>

  /** Rows inserted via `.insert().select()`, in order. */
  readonly inserted: InsertedRecord[] = []
  /** Update calls made via `.update().eq()`, in order. */
  readonly updates: UpdateRecord[] = []

  private counters: Record<string, number> = {}

  constructor(options: FakeSupabaseOptions = {}) {
    // Clone the seed so inserts/updates never mutate the caller's fixtures
    // (a shared `const seed = {...}` reused across tests would otherwise leak
    // rows between cases).
    this.tables = Object.fromEntries(
      Object.entries(options.tables ?? {}).map(([table, rows]) => [
        table,
        rows.map(row => ({ ...row })),
      ]),
    )
    this.selectErrors = options.selectErrors ?? {}
    this.insertErrors = options.insertErrors ?? {}
    this.updateErrors = options.updateErrors ?? {}
  }

  from(table: string) {
    return {
      select: (_cols: string) => new FakeSelectBuilder(this, table),
      insert: (row: Row) => ({
        select: async () => {
          const errorMessage = this.insertErrors[table]
          if (errorMessage) return { data: null, error: { message: errorMessage } }
          this.counters[table] = (this.counters[table] ?? 0) + 1
          const id = `${table}-${this.counters[table]}`
          const stored: Row = { ...row, id }
          if (!this.tables[table]) this.tables[table] = []
          this.tables[table].push(stored)
          this.inserted.push({ table, row: stored })
          return { data: [{ id }], error: null }
        },
      }),
      update: (patch: Row) => ({
        eq: async (column: string, value: string | number) => {
          const errorMessage = this.updateErrors[table]
          if (errorMessage) return { error: { message: errorMessage } }
          this.updates.push({ table, patch, eq: { column, value } })
          return { error: null }
        },
      }),
    }
  }
}

export interface FakeSupabaseHandle {
  /** The fake typed as the resolver dependency. */
  supa: SupabaseLike
  /** The underlying fake for assertions on recorded inserts/updates. */
  db: FakeSupabase
}

/** Build a fake `SupabaseLike` plus its recorder handle. */
export function makeFakeSupabase(options: FakeSupabaseOptions = {}): FakeSupabaseHandle {
  const db = new FakeSupabase(options)
  return { supa: db as unknown as SupabaseLike, db }
}

/** No-op audit writer — the resolvers pass this through to `extractStructured`. */
export const noopAudit: AuditWriter = {
  from: () => ({
    insert: async () => ({ error: null }),
  }),
}
