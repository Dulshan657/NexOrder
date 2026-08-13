// scripts/lib/importPlan.mjs
//
// The decisions `import-demo.mjs` has to make, with no I/O, so they can be
// tested. Same split as `_shared/wie/*` vs the functions that call it: the
// planning is pure, the writing is not.
//
// Three things live here:
//   planInsertOrder  — what order to insert tables in, and which columns must
//                      be deferred to a second pass
//   rewriteProjectRef — swap a Supabase project ref out of exported rows
//   contentTypeFor   — pick a Content-Type a bucket will actually accept

/**
 * Order tables parents-first and decide which foreign-key columns must be
 * written in a second pass.
 *
 * ── WHY THIS IS NOT THE MANIFEST'S `deferredForeignKeys` ────────────────────
 *
 * `export-demo.mjs` recorded a deferral list, and it cannot be used directly
 * for three separate reasons:
 *
 *   1. It records child→PARENT TABLE pairs, not columns. An importer needs to
 *      know which column to null, and a child can reference the same parent
 *      through several columns.
 *   2. It is a deliberate superset — when its frontier stalled it deferred ALL
 *      of the victim's remaining parents. Some of those columns are NOT NULL
 *      (`email_accounts.connected_by`, for one), and nulling a NOT NULL column
 *      fails outright. The export never had to care; it was reading.
 *   3. It drops self-references entirely, because a table orders within itself
 *      for an exporter. It does not for an importer: `locations` holds 1,408
 *      rows in ctid order and a bin inserted before its rack violates
 *      `locations.parent_id` immediately.
 *
 * So the order is recomputed here against the LIVE schema, and a cycle is only
 * ever broken on a NULLABLE column. If a cycle can only be broken on a NOT NULL
 * column this throws rather than emitting a plan that cannot work — that is a
 * schema shape no two-pass import can handle, and it should be reported as
 * such rather than discovered 40,000 rows in.
 *
 * @param {string[]} tables       table names to insert, in any order
 * @param {Array<{child:string,parent:string,column:string,nullable:boolean}>} fks
 * @returns {{order:string[], deferred:Map<string,string[]>}}
 */
export function planInsertOrder(tables, fks) {
  const set = new Set(tables)
  const relevant = fks.filter((f) => set.has(f.child) && set.has(f.parent))

  /** table -> Set(parent) */
  const deps = new Map(tables.map((t) => [t, new Set()]))
  /** table -> columns deferred to pass B */
  const deferred = new Map()

  const defer = (table, column) => {
    if (!deferred.has(table)) deferred.set(table, [])
    if (!deferred.get(table).includes(column)) deferred.get(table).push(column)
  }

  // A self-reference is ALWAYS deferred. Row order within a table is whatever
  // the export happened to produce, so there is no ordering that makes a tree
  // table safe — but nulling the link and restoring it afterwards always is.
  for (const f of relevant) {
    if (f.child !== f.parent) continue
    if (!f.nullable) {
      throw new Error(
        `${f.child}.${f.column} is a NOT NULL self-reference. ` +
          `Rows cannot be inserted in any order without violating it.`,
      )
    }
    defer(f.child, f.column)
  }

  const crossEdges = relevant.filter((f) => f.child !== f.parent)
  for (const f of crossEdges) deps.get(f.child).add(f.parent)

  const order = []
  const emitted = new Set()

  const release = (t) => {
    order.push(t)
    emitted.add(t)
    for (const other of tables) deps.get(other).delete(t)
  }

  while (emitted.size < tables.length) {
    // Alphabetical, so a plan is reproducible run to run and a diff of two runs
    // means something.
    const ready = tables.filter((t) => !emitted.has(t) && deps.get(t).size === 0).sort()
    if (ready.length) {
      for (const t of ready) release(t)
      continue
    }

    // Stalled: everything left is in or behind a cycle. Break the cheapest one,
    // and break it on a nullable column — never on the table with the fewest
    // parents, which is what the exporter did and which says nothing about
    // whether the break is legal.
    const stuck = tables.filter((t) => !emitted.has(t))
    const candidates = []
    for (const t of stuck.sort()) {
      for (const parent of [...deps.get(t)].sort()) {
        const cols = crossEdges.filter(
          (f) => f.child === t && f.parent === parent && f.nullable,
        )
        if (cols.length) candidates.push({ table: t, parent, columns: cols.map((c) => c.column) })
      }
    }

    if (!candidates.length) {
      throw new Error(
        `Cycle among [${stuck.sort().join(', ')}] has no nullable foreign key to break on. ` +
          `A two-pass import cannot resolve this.`,
      )
    }

    // Fewest columns to null wins: the smallest edit to the data.
    candidates.sort((a, b) => a.columns.length - b.columns.length)
    const pick = candidates[0]
    for (const c of pick.columns) defer(pick.table, c)
    deps.get(pick.table).delete(pick.parent)
  }

  return { order, deferred }
}

/**
 * Replace every occurrence of a Supabase project ref inside exported rows.
 *
 * Done over the serialised row rather than on named columns on purpose. In this
 * export the only hits are eight `orders.verification.signatureDataUrl` values —
 * buried inside a JSONB blob, which a column-name-based rewrite would never have
 * found. A ref is a 20-character opaque string that appears in no other role, so
 * a blind replace cannot damage anything, and the count is reported so a
 * surprise is visible rather than silent.
 *
 * @param {any[]} rows
 * @param {string} oldRef
 * @param {string} newRef
 * @returns {{rows:any[], replacements:number}}
 */
export function rewriteProjectRef(rows, oldRef, newRef) {
  if (!oldRef || oldRef === newRef) return { rows, replacements: 0 }
  const json = JSON.stringify(rows)
  const parts = json.split(oldRef)
  if (parts.length === 1) return { rows, replacements: 0 }
  return { rows: JSON.parse(parts.join(newRef)), replacements: parts.length - 1 }
}

const EXTENSION_TYPES = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
  eml: 'message/rfc822',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
}

const FALLBACK = 'application/octet-stream'

/**
 * Pick a Content-Type for a storage object that its bucket will accept.
 *
 * The export recorded keys and sizes but NOT mime types, and every bucket in
 * this schema carries an `allowed_mime_types` list — so an upload with the
 * wrong type is rejected with a 415, and an upload with no type at all lands as
 * `application/octet-stream`, which several buckets also refuse.
 *
 * The inferred type is used when the bucket allows it. When it does not, we
 * fall back to `application/octet-stream` IF the bucket allows that — which is
 * the real case for the single `.gif` sitting in `po-archive`, a bucket that
 * accepts octet-stream but not `image/gif`. Preserving the bytes under a vaguer
 * type is better than dropping the object, and the caller is told.
 *
 * @param {string} key
 * @param {string[]|null} allowedMimeTypes  bucket's allow-list, null = anything
 * @returns {{contentType:string, downgraded:boolean}|null} null = cannot upload
 */
export function contentTypeFor(key, allowedMimeTypes) {
  const ext = (key.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? '').toLowerCase()
  const inferred = EXTENSION_TYPES[ext] ?? FALLBACK

  if (!allowedMimeTypes || allowedMimeTypes.length === 0) {
    return { contentType: inferred, downgraded: false }
  }
  if (allowedMimeTypes.includes(inferred)) {
    return { contentType: inferred, downgraded: false }
  }
  if (allowedMimeTypes.includes(FALLBACK)) {
    return { contentType: FALLBACK, downgraded: true }
  }
  return null
}
