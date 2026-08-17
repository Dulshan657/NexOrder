// Operator-controlled location codes.
//
// A drawn bin's `locations.code` was a grid coordinate — `AMADIYA-B-3-4` — because
// that is where the cell happened to sit, not because anyone chose it. This module
// lets the operator state the pattern instead, and applies it either at draw time
// (from the warehouse's stored pattern) or as a sweep over a marquee-selected block.
//
// PURE. No Deno, no DOM, no I/O — the browser imports this through lib/codePattern.ts
// and the Edge Function imports it directly, so the operator's preview IS the
// server's decision rather than a second implementation of it. Same split as
// _shared/binCount.ts and _shared/wie/replenPolicy.ts. The I/O lives next door in
// _shared/locationCodeWrite.ts.
//
// ── {block}, and why it is NOT {area} ─────────────────────────────────────────
//
// The obvious move is to key the code off the painted named area, since mig 00094
// already draws a bin's NAME from exactly that. It is the wrong move, four times
// over:
//
//   * The operator's own example is `AMD-COLD-A` and `AMD-COLD-B` — two blocks
//     inside ONE painted "Cold Storage". No area binding produces both.
//   * An area name is 60 characters of free text with spaces and unicode. A code is
//     a path segment and a barcode whose WIDTH IS ITS READABILITY.
//   * Slugging is lossy: `Cold Store` and `Cold-Store` are two areas and one prefix,
//     which is a duplicate-code generator.
//   * An area is deliberately mutable — `rename_area` is cheap and expected. The
//     whole name_area/name_seq/name_is_auto triple exists BECAUSE display text moves
//     and the code cannot. Deriving the code from the area re-imports the exact
//     problem `name` was invented to solve.
//
// So `{block}` is an explicit, charset-validated string the operator types. If an
// area should ever drive a code, give it an opt-in `meta.codeBlock` beside the name
// — never `meta.name`.
//
// ── What the code still is, and why the rules below are not fussiness ─────────
//
// The code is the Code 128 payload, the `resolveScan` key, a `materialized_path`
// SEGMENT and the CSV `bin_code`. Three of those bite in ways the database will not
// catch:
//
//   * `normalizeScan` UPPERCASES. `AMD-A01` and `AMD-a01` are two rows to the global
//     UNIQUE constraint and ONE key to the scan resolver, which per its own contract
//     never guesses — it would return `ambiguous` forever. Codes are uppercase only.
//   * `barcodeVariants` zero-pads any digits-only string to GTIN-8/12/13/14, so a
//     digits-only bin code folds onto a product barcode. Refused outright.
//   * `_` and `%` are LIKE METACHARACTERS, and every path scope check in the system
//     is `LIKE '<path>/%'`. A code carrying one widens somebody else's query.
//
// Everything here REFUSES AND NAMES THE OFFENDER rather than repairing it — the
// gridScale.ts rule. A bin is a real `locations` row that may hold stock; quietly
// renaming it to something adjacent is how a sweep silently loses a pallet.
//
// ── One rule NOT inherited from the naming machinery ──────────────────────────
//
// `assignAutoNames` never reassigns a number, because a sign already screwed to the
// racking cannot be un-printed. A recode's entire PURPOSE is to rewrite codes, and
// the operator wants `01…24` contiguous. What is inherited is IDEMPOTENCE — a row
// already at its target is `unchanged`, never renumbered — and high-water seeding.
// What is not is "gaps are permanent". Do not "fix" that back.

// ─────────────────────────────────────────────────────────────────── constants ──

/** The `locations.code` column's practical ceiling, matching the zod cap at every
 *  Edge Function boundary that accepts a code. */
export const MAX_CODE_LENGTH = 48

/** How long a typed block may be before the rest of the pattern is added. */
export const MAX_BLOCK_LENGTH = 24

/** `wie_recode_locations_tx` parks every target at `~RECODE~<id>` between its two
 *  write phases so an A→B, B→A swap cannot trip the non-deferrable UNIQUE
 *  constraint. That only works while no real code can start with `~`. Change this
 *  and change the migration. */
export const PARK_PREFIX = '~RECODE~'

/** Handling units own `HU-` (mig 00074). `resolveScan` folds locations, SKUs and HU
 *  codes into one namespace, so a bin called `HU-000123` is a scan collision. */
export const HU_NAMESPACE = 'HU-'

export type CodeOrder = 'row' | 'column' | 'serpentine-row' | 'serpentine-column'

export const CODE_ORDERS: readonly CodeOrder[] = [
  'row', 'column', 'serpentine-row', 'serpentine-column',
]

export const CODE_ORDER_LABELS: Record<CodeOrder, string> = {
  'row': 'Left to right, top to bottom',
  'column': 'Top to bottom, left to right',
  'serpentine-row': 'Serpentine by row (walk order)',
  'serpentine-column': 'Serpentine by column (walk order)',
}

/**
 * Which corner of a painted block is `1-1`, and therefore which way the numbers run.
 *
 * Decomposes into two INDEPENDENT axis directions — `ne` is "y ascending, x
 * descending" — and each axis takes its direction from its own letter regardless of
 * which axis is primary. That one rule serves both `buildSelectionFrame` and
 * `orderCells`, which is what keeps `{n}` starting at the same bin `{row}`/`{col}`
 * call 1-1. Two separate rules would let the counter walk one way and the
 * coordinates the other, and nothing downstream would notice.
 */
export type CodeOrigin = 'nw' | 'ne' | 'sw' | 'se'

export const CODE_ORIGINS: readonly CodeOrigin[] = ['nw', 'ne', 'sw', 'se']

export const CODE_ORIGIN_LABELS: Record<CodeOrigin, string> = {
  nw: 'Top-left',
  ne: 'Top-right',
  sw: 'Bottom-left',
  se: 'Bottom-right',
}

/** Ascending on both axes — the historical behaviour, so it is the safe default. */
export const DEFAULT_ORIGIN: CodeOrigin = 'nw'

/** `true` = that axis counts downwards from its maximum. */
function originDirections(origin: CodeOrigin): { xDesc: boolean; yDesc: boolean } {
  return {
    xDesc: origin === 'ne' || origin === 'se',
    yDesc: origin === 'sw' || origin === 'se',
  }
}

export interface CodePattern {
  template: string
  /** What `{block}` resolves to when the operator has not armed one. */
  defaultBlock: string
  start: number
  order: CodeOrder
  origin: CodeOrigin
}

/**
 * What a warehouse with no `warehouse_code_patterns` row gets.
 *
 * THIS MUST FORMAT BYTE-FOR-BYTE IDENTICALLY TO THE HISTORICAL GRID CODE. "No row =
 * built-in default" is what lets the table ship empty with nothing backfilled, and
 * it is only safe while this is a no-op on every existing site. A test pins it.
 *
 * It is the COMPATIBILITY FALLBACK and nothing else. What the wizard arms is
 * `WIZARD_DEFAULT_PATTERN` below. Do not "improve" this one — the two are separate
 * precisely so a better default cannot reach a site nobody swept.
 */
export const BUILTIN_PATTERN: CodePattern = {
  template: '{wh}-{block}-{x}-{y}',
  defaultBlock: 'B',
  start: 1,
  order: 'row',
  origin: DEFAULT_ORIGIN,
}

/**
 * What the recode wizard opens on.
 *
 * `{x}`/`{y}` are absolute GRID coordinates, so the built-in pattern renders a bin's
 * map position — an operator who painted one bin, typed BULK and expected
 * `AMADIYA-BULK-1-1` got `AMADIYA-BULK-3-3`. Worse, that template carries no counter
 * at all, so `start` and `order` were controls wired to nothing. `{row}`/`{col}`
 * count within the painted selection instead, which is what an operator means by
 * "the first bin of this block".
 */
export const WIZARD_DEFAULT_PATTERN: CodePattern = {
  template: '{wh}-{block}-{row}-{col}',
  defaultBlock: 'B',
  start: 1,
  order: 'row',
  origin: DEFAULT_ORIGIN,
}

// ─────────────────────────────────────────────────────────────────── templates ──

/** Tokens a template may carry. `text` tokens may not take a padding spec — padding
 *  a warehouse code is meaningless and almost always a typo for `{n:02}`. */
const TOKEN_KIND: Record<string, 'text' | 'number'> = {
  wh: 'text',
  block: 'text',
  n: 'number',
  // ABSOLUTE grid coordinates — where the cell sits on the map. Kept for the
  // built-in pattern and for anyone who genuinely wants map position in the code.
  x: 'number',
  y: 'number',
  // SELECTION-RELATIVE coordinates — where the unit sits inside the painted block,
  // counted densely from the chosen origin. The first bin of every block is 1-1.
  row: 'number',
  col: 'number',
  floor: 'number',
}

/** `{name}` or `{name:0N}`, N a single digit. */
const TOKEN_RE = /\{([A-Za-z]+)(?::0(\d))?\}/g

/** Characters that must never reach a code, each for its own reason. */
const FORBIDDEN_LITERALS: Array<[string, string]> = [
  ['/', 'A code may not contain "/" — it is a location path separator'],
  ['%', 'A code may not contain "%" — it is a LIKE wildcard and storage keys reject it'],
  ['_', 'A code may not contain "_" — it is a LIKE wildcard that would widen path queries'],
  ['\\', 'A code may not contain "\\"'],
]

export interface CodeBindings {
  /** The warehouse's own code. */
  wh: string
  /** The armed or stored block. Empty renders nothing. */
  block: string
  /** Absolute grid coordinates. Nullable for the same reason `n` is — rendering
   *  with every number absent yields the constant half of a code, which is how both
   *  a pool key and the map's ghost-label prefix are derived. Every real call binds
   *  them. */
  x: number | null
  y: number | null
  /** The counter. NULL suppresses the token. */
  n: number | null
  /** Position inside the painted block, 1-based and dense. Optional and NULL-able
   *  for the same reason `n` is: a caller with no frame renders the token away
   *  rather than inventing a coordinate. Every pre-existing call site binds
   *  neither, which is what keeps this change additive. */
  row?: number | null
  col?: number | null
  floor?: number | null
}

/**
 * Reduce free text to something a code may legally carry.
 *
 * Deliberately lossy and deliberately uppercase: `resolveScan` folds to upper, so a
 * block that preserved case would produce codes that look distinct and scan alike.
 * Idempotent — a test pins that, because the input field sanitizes per keystroke and
 * the server sanitizes again.
 */
export function sanitizeBlock(raw: string): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MAX_BLOCK_LENGTH)
    .replace(/[-.]+$/g, '')
}

/** Per-keystroke variant: keeps a trailing separator so the operator can type one.
 *  Mirrors `sanitizeAreaNameInput` next to `sanitizeAreaName`. */
export function sanitizeBlockInput(raw: string): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_BLOCK_LENGTH)
}

export function blockIssue(raw: string): string | null {
  const clean = sanitizeBlock(raw)
  if (!clean) return 'Give the block a name'
  if (clean !== (raw ?? '').trim()) return `Will be stored as "${clean}"`
  return null
}

/** Left-pad a number to `width`. Never truncates — a number wider than its padding
 *  is printed in full, because dropping a digit changes which bin it names. */
function padNumber(value: number, width: number): string {
  const text = String(value)
  return width > text.length ? text.padStart(width, '0') : text
}

/**
 * The operator-facing reason a template cannot be used, or null when it is fine.
 *
 * SYNTAX only. A template with no `{n}` is perfectly legal — `{wh}-{block}-{x}-{y}`
 * is the built-in default — and only becomes a problem when a sweep uses it and
 * every unit renders the same string. `planRecode` catches that as a duplicate,
 * where the message can say how many rows collided and which token is missing.
 */
export function templateIssue(template: string): string | null {
  const raw = template ?? ''
  if (!raw.trim()) return 'Give the pattern some text'
  if (raw.length > 64) return 'Pattern is too long'
  for (const [char, message] of FORBIDDEN_LITERALS) {
    if (raw.includes(char)) return message
  }

  const problems: string[] = []
  const stripped = raw.replace(TOKEN_RE, (_m, name: string, pad: string | undefined) => {
    const kind = TOKEN_KIND[name]
    if (!kind) problems.push(`unknown:${name}`)
    else if (pad !== undefined && kind !== 'number') problems.push(`pad:${name}`)
    return ' '
  })

  const unknown = problems.find((p) => p.startsWith('unknown:'))
  if (unknown) {
    const known = Object.keys(TOKEN_KIND).map((k) => `{${k}}`).join(', ')
    return `Unknown token {${unknown.slice('unknown:'.length)}} — use one of ${known}`
  }
  const padded = problems.find((p) => p.startsWith('pad:'))
  if (padded) return `{${padded.slice('pad:'.length)}} is text and cannot be zero-padded`

  // Anything brace-shaped left behind never matched the token grammar.
  if (stripped.includes('{') || stripped.includes('}')) return 'Unclosed or malformed {token}'
  return null
}

/**
 * Every token a template actually carries.
 *
 * This is what makes a control honest. The reported bug was not that the numbering
 * was wrong — it was that `Start at` and `Order` were RENDERED while the armed
 * template held no `{n}`, so the operator changed them, saw nothing happen, and had
 * no way to find out why. A control may only be shown when its token is present, and
 * this is the one question that answers.
 */
export function usedTokens(template: string): Set<string> {
  const found = new Set<string>()
  // A fresh regex: TOKEN_RE is global and shared, and matchAll on the shared one
  // would be one lastIndex bug away from a token going missing.
  const re = new RegExp(TOKEN_RE.source, 'g')
  for (const m of (template ?? '').matchAll(re)) found.add(m[1])
  return found
}

/** The numbering shapes the wizard's form can express. Anything else is `custom` and
 *  is only reachable through the advanced template field. */
export type NumberingStyle = 'row-col' | 'sequence' | 'custom'

/** DERIVED from the template, never stored. Two representations of one fact is two
 *  ways to disagree — the reason `numbering_style` is not a column. */
export function styleOfTemplate(template: string): NumberingStyle {
  const used = usedTokens(template)
  if (used.has('row') && used.has('col')) return 'row-col'
  if (used.has('n') && !used.has('row') && !used.has('col')) return 'sequence'
  return 'custom'
}

/** The inverse, for the form's own controls. `pad: 0` means no padding spec. */
export function templateForStyle(
  style: NumberingStyle,
  opts: { pad: number; colFirst: boolean },
): string {
  const tok = (name: string) => (opts.pad > 0 ? `{${name}:0${opts.pad}}` : `{${name}}`)
  if (style === 'sequence') return `{wh}-{block}-${tok('n')}`
  if (style === 'row-col') {
    const [a, b] = opts.colFirst ? ['col', 'row'] : ['row', 'col']
    return `{wh}-{block}-${tok(a)}-${tok(b)}`
  }
  return BUILTIN_PATTERN.template
}

/**
 * Render one code.
 *
 * A token whose value is absent renders empty and its neighbouring separator is
 * collapsed with it, so `{wh}-{block}-{n:02}` with no block gives `AMD-03` rather
 * than `AMD--03`. That collapse is also what turns a template into a pool key:
 * render with `n: null` and the counter falls out along with its hyphen.
 */
export function formatCode(template: string, b: CodeBindings): string {
  const rendered = (template ?? '').replace(TOKEN_RE, (_m, name: string, pad: string | undefined) => {
    const width = pad ? Number(pad) : 0
    switch (name) {
      case 'wh': return sanitizeBlock(b.wh ?? '')
      case 'block': return b.block ? sanitizeBlock(b.block) : ''
      case 'n': return b.n === null || b.n === undefined ? '' : padNumber(b.n, width)
      case 'x': return b.x === null || b.x === undefined ? '' : padNumber(b.x, width)
      case 'y': return b.y === null || b.y === undefined ? '' : padNumber(b.y, width)
      case 'row': return b.row === null || b.row === undefined ? '' : padNumber(b.row, width)
      case 'col': return b.col === null || b.col === undefined ? '' : padNumber(b.col, width)
      case 'floor': return b.floor === null || b.floor === undefined ? '' : padNumber(b.floor, width)
      default: return ''
    }
  })
  return rendered.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * The level suffix rule, unchanged since rack levels shipped: a level's code is its
 * rack's code plus `-L<index>`, which is what `rackCodeFromLevels` parses back off.
 *
 * `components/warehouse/levels/rackLevels.ts` re-exports this rather than keeping a
 * second copy — forking a string composer is the hazard `scanNormalize.ts` and
 * `signPaint.ts` both document, and here it would leave a rack and its levels under
 * two different code families.
 */
export function levelCodeFor(rackCode: string, levelIndex: number): string {
  return `${rackCode}-L${levelIndex}`
}

// ────────────────────────────────────────────────────────────────── validation ──

export type CodeIssueKind =
  | 'empty' | 'reserved' | 'path_separator' | 'like_wildcard'
  | 'charset' | 'too_long' | 'numeric_only'

/** Everything a code may contain. A strict subset of Code 128 Set B, and a superset
 *  of every code in the system today. Uppercase only (see the header), no `_`, no
 *  space — a space encodes fine and is a menace on a sticker and in a CSV. */
const CODE_CHARSET = /^[A-Z0-9.-]+$/

/**
 * Why this string cannot be a location code, or null when it can.
 *
 * The specific checks run before the general one so the operator is told which rule
 * they broke rather than a blanket "bad characters".
 */
export function codeIssue(code: string): CodeIssueKind | null {
  const raw = code ?? ''
  if (!raw.trim()) return 'empty'
  if (raw.startsWith('~') || raw.toUpperCase().startsWith(HU_NAMESPACE)) return 'reserved'
  if (raw.includes('/')) return 'path_separator'
  if (raw.includes('%') || raw.includes('_')) return 'like_wildcard'
  if (!CODE_CHARSET.test(raw)) return 'charset'
  if (raw.length > MAX_CODE_LENGTH) return 'too_long'
  if (/^\d+$/.test(raw)) return 'numeric_only'
  return null
}

export type RecodeRefusalKind =
  | CodeIssueKind | 'duplicate' | 'collision' | 'kind' | 'template' | 'drift'

export function describeCodeIssue(kind: RecodeRefusalKind, code: string): string {
  switch (kind) {
    case 'empty': return 'the pattern rendered nothing'
    case 'reserved': return `"${code}" is in a reserved namespace (${PARK_PREFIX} or ${HU_NAMESPACE})`
    case 'path_separator': return `"${code}" contains "/", which is a location path separator`
    case 'like_wildcard': return `"${code}" contains a LIKE wildcard ("%" or "_"), which would widen path queries`
    case 'charset': return `"${code}" must be uppercase letters, digits, dot or hyphen only`
    case 'too_long': return `"${code}" is ${code.length} characters; the limit is ${MAX_CODE_LENGTH}`
    case 'numeric_only': return `"${code}" is all digits, which a scanner would read as a product barcode`
    case 'duplicate': return `"${code}" would be given to more than one location`
    case 'collision': return `"${code}" is already in use by another location`
    case 'kind': return `"${code}" is not a storage location — recoding it would rewrite every path beneath it`
    case 'template': return code
    case 'drift': return code
  }
}

// ──────────────────────────────────────────────────────────────────── ordering ──

export interface RecodeCell {
  floor: number
  x: number
  y: number
}

/**
 * Put a selection into the order its numbers should run in.
 *
 * Serpentine is not a nicety: an operator walking an aisle goes up one side and back
 * down the other, and numbering that reverses with them is the difference between
 * consecutive codes being adjacent bays and being opposite ends of the building.
 * Floors sort outermost — a walk cannot cross one.
 */
export function orderCells<T extends RecodeCell>(
  items: readonly T[],
  order: CodeOrder,
  origin: CodeOrigin = DEFAULT_ORIGIN,
): T[] {
  const rows = order === 'row' || order === 'serpentine-row'
  const serpentine = order === 'serpentine-row' || order === 'serpentine-column'
  const dir = originDirections(origin)

  // Primary axis = the one that changes slowest (the "line" being walked). Each axis
  // takes its direction from its own component of the origin, so `nw` reproduces the
  // historical ascending/ascending walk exactly.
  const primary = (c: RecodeCell) => (rows ? c.y : c.x)
  const secondary = (c: RecodeCell) => (rows ? c.x : c.y)
  const primaryDesc = rows ? dir.yDesc : dir.xDesc
  const secondaryDesc = rows ? dir.xDesc : dir.yDesc

  // Serpentine alternates by POSITION IN THE SORTED SEQUENCE of lines, not by the
  // raw coordinate's parity: a selection starting at y=7 must still begin forwards.
  // That stays true under a reversed origin, where the first line is the LAST
  // coordinate — which is precisely why this indexes the sorted sequence.
  const byFloor = new Map<number, Map<number, number>>()
  for (const floor of new Set(items.map((i) => i.floor))) {
    const lines = [...new Set(items.filter((i) => i.floor === floor).map(primary))]
      .sort((a, b) => (primaryDesc ? b - a : a - b))
    byFloor.set(floor, new Map(lines.map((v, i) => [v, i])))
  }

  return [...items].sort((a, b) => {
    if (a.floor !== b.floor) return a.floor - b.floor
    const pa = primary(a); const pb = primary(b)
    if (pa !== pb) return primaryDesc ? pb - pa : pa - pb
    const reversed = (serpentine && (byFloor.get(a.floor)!.get(pa)! % 2 === 1)) !== secondaryDesc
    const sa = secondary(a); const sb = secondary(b)
    return reversed ? sb - sa : sa - sb
  })
}

// ─────────────────────────────────────────────────────── selection coordinates ──

export interface GridIndex {
  row: number
  col: number
}

export interface SelectionFrame {
  /** `frameKey(cell)` → its 1-based position inside the block. */
  index: ReadonlyMap<string, GridIndex>
  /** The deepest and widest any floor of the selection runs, for the UI's preview. */
  rows: number
  cols: number
}

export function frameKey(c: RecodeCell): string {
  return `${c.floor}:${c.x}:${c.y}`
}

/**
 * Rank a painted selection into 1-based (row, col) from the chosen origin.
 *
 * DENSE ON BOTH AXES. Only lines that actually hold a unit are ranked, so the
 * walkway between two rack runs does not burn a row number and a hole in a run does
 * not burn a column. That is the operator's call and it is the whole difference from
 * `{x}`/`{y}`: a coordinate here counts things, not cells.
 *
 * Contiguity of the COUNTER is a separate question and stays `{n}`'s job — `{n}`
 * never skips, whatever the geometry does.
 *
 * Floors are ranked independently. A walk cannot cross one, so neither can a frame.
 */
export function buildSelectionFrame(
  cells: readonly RecodeCell[],
  origin: CodeOrigin = DEFAULT_ORIGIN,
): SelectionFrame {
  const dir = originDirections(origin)
  const index = new Map<string, GridIndex>()
  let rows = 0
  let cols = 0

  for (const floor of new Set(cells.map((c) => c.floor))) {
    const onFloor = cells.filter((c) => c.floor === floor)
    const rank = (values: number[], desc: boolean) => {
      const sorted = [...new Set(values)].sort((a, b) => (desc ? b - a : a - b))
      return new Map(sorted.map((v, i) => [v, i + 1]))
    }
    const rowRank = rank(onFloor.map((c) => c.y), dir.yDesc)
    const colRank = rank(onFloor.map((c) => c.x), dir.xDesc)
    rows = Math.max(rows, rowRank.size)
    cols = Math.max(cols, colRank.size)
    for (const c of onFloor) {
      index.set(frameKey(c), { row: rowRank.get(c.y)!, col: colRank.get(c.x)! })
    }
  }

  return { index, rows, cols }
}

// ──────────────────────────────────────────────────────────────────── planning ──

/** Kinds a sweep may touch. A ZONE or AISLE code is a path segment for every bin
 *  beneath it, so recoding one is a vastly larger rewrite than "select some bins". */
const RECODABLE_KINDS = new Set(['BIN', 'RACK', 'BAY', 'SHELF', 'STAGING'])

export interface RecodeLevel {
  id: number
  levelIndex: number
  code: string
  labelPrinted?: boolean
}

export interface RecodeUnit extends RecodeCell {
  id: number
  /** The code it carries today. */
  code: string
  /** Stored provenance, so an unchanged sweep is recognised as a no-op. */
  codeBlock: string | null
  codeSeq: number | null
  kind?: string
  /** True once an operator confirmed a sticker is physically on it (mig 00084). */
  labelPrinted?: boolean
  hasStock?: boolean
  /** A levelled rack's SHELF children. They MUST ride in the same batch: a SHELF's
   *  materialized_path is composed at creation and never read back from its rack, so
   *  a rack recoded without its levels leaves every child path pointing at a code no
   *  row holds. */
  levels?: RecodeLevel[]
}

export interface RecodeOptions {
  template: string
  /** One block per sweep — the operator states it. */
  block: string
  start: number
  order: CodeOrder
  /** The warehouse's own code, for `{wh}`. */
  wh: string
  /** Every code that exists, LOWERCASED, mapped to the id that owns it. Inactive
   *  rows included — they still own their codes. A code held by a unit in this batch
   *  is not a collision, it is a swap, which the two-phase write handles. */
  takenCodes: ReadonlyMap<string, number>
  /** Which corner of the block is 1-1. Defaults to the historical ascending walk. */
  origin?: CodeOrigin
  /** The cells the frame is ranked over, when that is wider than what is being
   *  written. Growing a block frames over the UNION of the block's existing members
   *  and the newly painted units, so a bin added to the end of a run gets the next
   *  column rather than restarting at 1. Defaults to the units' own cells. */
  frameCells?: readonly RecodeCell[]
  /** Units already carrying this block that are NOT being written. They are planned
   *  anyway, purely to check they still render the code they already hold — see
   *  `RecodePlan.drift`. */
  incumbents?: readonly RecodeUnit[]
}

/** An existing member of the block whose code this sweep would move. */
export interface RecodeDrift {
  id: number
  /** What it carries today. */
  code: string
  /** What this framing would give it. */
  would: string
}

export interface RecodeLevelWrite {
  id: number
  levelIndex: number
  from: string
  to: string
}

export interface RecodeWrite {
  id: number
  from: string
  to: string
  codeBlock: string
  seq: number
  levels: RecodeLevelWrite[]
}

export interface RecodeRefusal {
  /** 0 for a whole-batch problem such as a malformed template. */
  id: number
  from: string
  to: string
  kind: RecodeRefusalKind
  detail: string
  /** For a collision: the id that already owns the code. */
  heldBy?: number
}

export interface RecodePlan {
  writes: RecodeWrite[]
  /** Units already carrying exactly what this sweep would give them. */
  unchanged: number
  /** Non-empty means NOTHING is written. See the note on planRecode. */
  refusals: RecodeRefusal[]
  /** Ids whose sticker is already on the racking. A warning, never a refusal — but
   *  the caller MUST reset `label_printed` on them, or the backlog badge claims zero
   *  outstanding while every sticker on the rack is wrong. */
  labelPrinted: number[]
  /** Ids holding stock. Informational: `inventory_balances.location_id` is an id, so
   *  stock follows the row. A picker on a paper list will still be surprised. */
  holdingStock: number[]
  /** Where the counter reached, for prefilling the next sweep. */
  nextCounter: number
  /** Every code this sweep would produce, in order — hand to `fitRun` to size the
   *  barcode before the operator commits to a pattern they cannot print. */
  allCodes: string[]
  /** How deep and wide the frame ran, for the panel's preview. */
  frame: { rows: number; cols: number }
  /** Existing block members this framing would move. Non-empty raises a `drift`
   *  refusal, which voids the batch like any other — growing a block must never
   *  renumber the bins already labelled for it. The operator's way past it is to
   *  re-frame, or to say explicitly that the whole block is being renumbered. */
  drift: RecodeDrift[]
}

const lower = (s: string) => s.toLowerCase()

/**
 * Work out what a sweep would do.
 *
 * ANY refusal voids the WHOLE batch. That is deliberate and differs from
 * `count-bin`, where a refused line is reported and the rest still post: there, each
 * line is an independent fact about the floor and half the truth beats none. Here
 * the operator is establishing a scheme across a block, half a scheme is worse than
 * none, and nothing is lost by refusing — they fix the block and re-run. Same spirit
 * as gridScale's refuse-never-round.
 *
 * Every offender is collected before returning rather than throwing on the first:
 * the refusals are a list the operator has to act on, and one per round trip is a
 * bad tool.
 */
export function planRecode(units: readonly RecodeUnit[], opts: RecodeOptions): RecodePlan {
  const empty: RecodePlan = {
    writes: [], unchanged: 0, refusals: [], labelPrinted: [], holdingStock: [],
    nextCounter: opts.start, allCodes: [], frame: { rows: 0, cols: 0 }, drift: [],
  }

  const bad = templateIssue(opts.template)
  if (bad) {
    return { ...empty, refusals: [{ id: 0, from: '', to: '', kind: 'template', detail: bad }] }
  }

  const block = sanitizeBlock(opts.block)
  const origin = opts.origin ?? DEFAULT_ORIGIN
  // The frame spans the union when growing a block, so an appended bin continues the
  // run instead of restarting it. With no `frameCells` it is just the selection.
  const frame = buildSelectionFrame(opts.frameCells ?? units, origin)
  const at = (c: RecodeCell) => frame.index.get(frameKey(c)) ?? null
  const ordered = orderCells(units, opts.order, origin)
  const refusals: RecodeRefusal[] = []
  const labelPrinted: number[] = []
  const holdingStock: number[] = []
  const allCodes: string[] = []

  // Every id this batch owns — its units and their levels. A code held by one of
  // these is not a collision, it is a swap.
  const ownIds = new Set<number>()
  for (const u of units) {
    ownIds.add(u.id)
    for (const l of u.levels ?? []) ownIds.add(l.id)
  }

  // Provisional results, validated as a set once every code is known.
  const drafts: Array<{ unit: RecodeUnit; to: string; seq: number; levels: RecodeLevelWrite[] }> = []
  const producedBy = new Map<string, number[]>()
  const claim = (code: string, id: number) => {
    const key = lower(code)
    const held = producedBy.get(key)
    if (held) held.push(id)
    else producedBy.set(key, [id])
  }

  let seq = opts.start
  for (const unit of ordered) {
    const cell = at(unit)
    const to = formatCode(opts.template, {
      wh: opts.wh, block, x: unit.x, y: unit.y, n: seq, floor: unit.floor,
      row: cell?.row ?? null, col: cell?.col ?? null,
    })
    claim(to, unit.id)
    allCodes.push(to)

    const levels: RecodeLevelWrite[] = (unit.levels ?? []).map((l) => {
      const levelTo = levelCodeFor(to, l.levelIndex)
      claim(levelTo, l.id)
      allCodes.push(levelTo)
      if (l.labelPrinted) labelPrinted.push(l.id)
      return { id: l.id, levelIndex: l.levelIndex, from: l.code, to: levelTo }
    })

    if (unit.labelPrinted) labelPrinted.push(unit.id)
    if (unit.hasStock) holdingStock.push(unit.id)
    drafts.push({ unit, to, seq, levels })
    seq += 1
  }

  // ── validate every produced code, as a set ──
  for (const draft of drafts) {
    if (draft.unit.kind && !RECODABLE_KINDS.has(draft.unit.kind)) {
      refusals.push({
        id: draft.unit.id, from: draft.unit.code, to: draft.to, kind: 'kind',
        detail: describeCodeIssue('kind', draft.unit.code),
      })
      continue
    }

    const rows: Array<{ id: number; from: string; to: string }> = [
      { id: draft.unit.id, from: draft.unit.code, to: draft.to },
      ...draft.levels,
    ]
    for (const row of rows) {
      const issue = codeIssue(row.to)
      if (issue) {
        refusals.push({ ...row, kind: issue, detail: describeCodeIssue(issue, row.to) })
        continue
      }
      const key = lower(row.to)
      if ((producedBy.get(key) ?? []).length > 1) {
        refusals.push({ ...row, kind: 'duplicate', detail: describeCodeIssue('duplicate', row.to) })
        continue
      }
      const owner = opts.takenCodes.get(key)
      if (owner !== undefined && !ownIds.has(owner)) {
        refusals.push({
          ...row, kind: 'collision', heldBy: owner,
          detail: describeCodeIssue('collision', row.to),
        })
      }
    }
  }

  // ── would this framing move a bin that is already in the block? ──
  //
  // An incumbent keeps its own `code_seq`, so a pure-{n} template can never drift —
  // only a coordinate template can, and only when the painted cells change the shape
  // of the frame. That asymmetry is the point: it is exactly the case where the codes
  // already on the racking would stop matching the geometry.
  const drift: RecodeDrift[] = []
  for (const inc of opts.incumbents ?? []) {
    const cell = at(inc)
    const would = formatCode(opts.template, {
      wh: opts.wh, block, x: inc.x, y: inc.y, n: inc.codeSeq, floor: inc.floor,
      row: cell?.row ?? null, col: cell?.col ?? null,
    })
    if (would !== inc.code) drift.push({ id: inc.id, code: inc.code, would })
  }
  if (drift.length > 0) {
    const names = drift.slice(0, 3).map((d) => `${d.code}→${d.would}`).join(', ')
    refusals.push({
      id: 0, from: '', to: '', kind: 'drift',
      detail: `${drift.length} location(s) already in "${block}" would be renumbered (${names}${
        drift.length > 3 ? ', …' : ''
      }). Re-frame the block, or renumber all of it deliberately.`,
    })
  }

  if (refusals.length > 0) {
    return {
      ...empty, refusals, labelPrinted, holdingStock, nextCounter: seq, allCodes,
      frame: { rows: frame.rows, cols: frame.cols }, drift,
    }
  }

  const writes: RecodeWrite[] = []
  let unchanged = 0
  for (const draft of drafts) {
    const settled =
      draft.unit.code === draft.to &&
      draft.unit.codeBlock === block &&
      draft.unit.codeSeq === draft.seq &&
      draft.levels.every((l) => l.from === l.to)
    if (settled) {
      unchanged += 1
      continue
    }
    writes.push({
      id: draft.unit.id,
      from: draft.unit.code,
      to: draft.to,
      codeBlock: block,
      seq: draft.seq,
      levels: draft.levels,
    })
  }

  return {
    writes, unchanged, refusals, labelPrinted, holdingStock, nextCounter: seq, allCodes,
    frame: { rows: frame.rows, cols: frame.cols }, drift,
  }
}

/**
 * Which (origin, order) reproduces a block's existing codes — null when none does.
 *
 * A block's framing is RECOVERABLE, so it is not stored. Storing `(row, col)` on
 * `locations` would be a third hand-maintained copy of geometry beside `parent_id`
 * and `materialized_path`, which mig 00096 is a monument to the cost of; and a stored
 * high-water gets growth wrong anyway, because a row painted NORTH of a north-origin
 * block has to become row 1 and push the rest down. Solving reads the answer off the
 * floor instead, and when nothing reproduces the incumbents — a hand-typed block, or
 * one swept under a template since changed — it says so rather than guessing a frame
 * that would silently renumber real racking.
 *
 * 16 candidates over a few hundred units of pure arithmetic.
 */
export function solveBlockFraming(
  incumbents: readonly RecodeUnit[],
  opts: Pick<RecodeOptions, 'template' | 'block' | 'wh'>,
): { origin: CodeOrigin; order: CodeOrder } | null {
  if (incumbents.length === 0) return null
  const block = sanitizeBlock(opts.block)

  for (const origin of CODE_ORIGINS) {
    const frame = buildSelectionFrame(incumbents, origin)
    for (const order of CODE_ORDERS) {
      const fits = incumbents.every((inc) => {
        const cell = frame.index.get(frameKey(inc)) ?? null
        return formatCode(opts.template, {
          wh: opts.wh, block, x: inc.x, y: inc.y, n: inc.codeSeq, floor: inc.floor,
          row: cell?.row ?? null, col: cell?.col ?? null,
        }) === inc.code
      })
      if (fits) return { origin, order }
    }
  }
  return null
}
