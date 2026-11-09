// What an upload of QuickBooks invoices does, with every database call passed in.
//
// `preview` works out one verdict per invoice and writes nothing. `commit` works
// them all out AGAIN from the file text, because the world may have moved since
// the preview, and then acts on each invoice on its own: one invoice's failure is
// reported against that invoice and never stops the next.
//
// A ROW THAT FAILED TO PARSE REJECTS ITS WHOLE INVOICE, even if other rows parsed.
// Importing the rest would create an order short of a line nobody was told about.
// The exception is a sound row with a bad quantity or price, or no product, whose
// product is neither mapped nor the tenant's own. That is a freight or discount line,
// nothing is short without it, and it is skipped and named like any other brand's.
//
// Every row of the file ends up in a verdict's `rowNumbers` or in
// `unattachedRowErrors`, so no line can vanish.
//
// PURITY: no platform globals, no I/O and no clock. `deps` holds all of that.

import {
  classifyInvoices,
  diffAgainstStored,
  normaliseName,
  normaliseProductName,
  type ClassifyCustomer,
  type InvoiceDifference,
  type InvoiceVerdict,
  type MappedLine,
  type ProductMapRow,
  type StoredImport,
} from './classifyInvoices.ts'
import { parseInvoices, type QbParseError, type QbParseResult } from './parseInvoices.ts'
import type { QbLine } from './types.ts'

const ALLOWED_ROLES: readonly string[] = ['Admin', 'Manager']

/** What is stored against an import that has, or has had, a flag. */
export interface StoredFlag {
  invoiceNumber: string
  flaggedChange: unknown
  flagResolvedAt: string | null
}

export interface ImportFacts {
  customers: ClassifyCustomer[]
  productMap: ProductMapRow[]
  storedImports: StoredImport[]
  storedFlags: StoredFlag[]
  ownProductPrefixes: readonly string[]
  ownProductTerms: readonly string[]
}

export interface InvoiceWrite {
  invoiceNumber: string
  horecaId: number
  invoiceDate: string
  lines: MappedLine[]
}

export type ImportTxResult = { status: 'created' | 'already_imported'; orderId: string }

export type UpdateTxResult =
  | { status: 'updated'; orderId: string }
  | { status: 'refused'; reason: string }
  | { status: 'not_found' }

export type AdvanceResult = { ok: true } | { ok: false; code: string }

export interface ImportDeps {
  loadFacts(invoiceNumbers: readonly string[]): Promise<ImportFacts>
  importInvoice(write: InvoiceWrite): Promise<ImportTxResult>
  updateInvoice(write: InvoiceWrite): Promise<UpdateTxResult>
  /** Replaces whatever is stored and reopens the flag. Called only for new differences. */
  flagChange(invoiceNumber: string, differences: InvoiceDifference[]): Promise<void>
  /** Removes the flag and its resolution: the file matches the order again. */
  clearFlag(invoiceNumber: string): Promise<void>
  /** What is stored now, for when a transaction says another upload got there first. */
  loadStoredImport(invoiceNumber: string): Promise<{ stored: StoredImport; flag: StoredFlag | null } | null>
  advanceToProcessed(orderId: string): Promise<AdvanceResult>
  logError?(invoiceNumber: string, error: unknown): void
}

export interface ImportRequest {
  action: 'preview' | 'commit'
  csvText: string
  applyChanges?: readonly string[]
  actorRole: string
}

export interface ImportCounts {
  added: number
  unchanged: number
  changed: number
  /** Lines, not invoices: every line that belongs to another brand. */
  skipped: number
  /** Rejected invoices, plus rows that name no invoice. */
  rejected: number
}

export type InvoiceOutcome =
  | 'added'
  | 'updated'
  | 'flagged'
  | 'unchanged'
  | 'finished'
  | 'skipped'
  | 'rejected'
  | 'refused'
  | 'failed'

export interface InvoiceResult {
  invoiceNumber: string
  outcome: InvoiceOutcome
  orderId?: string
  message?: string
}

export type ResultCounts = Record<InvoiceOutcome, number>

export interface SkippedLine {
  invoiceNumber: string
  name: string
  rowNumber: number
}

export interface IgnoredSelection {
  invoiceNumber: string
  reason: string
}

export interface ImportOk {
  status: 'ok'
  action: 'preview' | 'commit'
  counts: ImportCounts
  verdicts: InvoiceVerdict[]
  /** Reasons the whole file was refused. Nothing else is filled in when there are any. */
  fileErrors: string[]
  /** Rows that name no invoice, so they belong to no verdict. */
  unattachedRowErrors: QbParseError[]
  skippedLines: SkippedLine[]
  /** Already imported, unchanged, and still short of the Pick Queue: commit finishes them. */
  unfinishedInvoices: string[]
  /** Unchanged, with an old flag this file no longer supports: commit clears it. */
  staleFlagInvoices: string[]
  /** The customer as the file names it, by invoice, so a person can check the preview. */
  invoiceCustomers: Record<string, string>
  results?: InvoiceResult[]
  resultCounts?: ResultCounts
  ignoredApplyChanges?: IgnoredSelection[]
}

export type ImportResponse = ImportOk | { status: 'forbidden'; message: string }

// ---------------------------------------------------------------------------
// The tenant's own-product rule
// ---------------------------------------------------------------------------

/** Unmapped names starting with a prefix or holding a term are the tenant's own.
 *  Blank entries are dropped: an empty prefix would otherwise match every name. */
export function buildOwnProductRule(prefixes: readonly string[], terms: readonly string[]): (name: string) => boolean {
  const clean = (list: readonly string[]): string[] => list.map(normaliseName).filter((entry) => entry !== '')
  const ownPrefixes = clean(prefixes)
  const ownTerms = clean(terms)
  return (name) => {
    const normal = normaliseName(name)
    return ownPrefixes.some((prefix) => normal.startsWith(prefix)) || ownTerms.some((term) => normal.includes(term))
  }
}

// ---------------------------------------------------------------------------
// Plain words for the office
// ---------------------------------------------------------------------------

const CODED_MESSAGES: Readonly<Record<string, string>> = {
  QB_ALLOCATION_MISMATCH:
    'The stock held for this order no longer matches the warehouse, so the order was left as it was. Ask the warehouse to check it.',
  QB_ORDER_ID_TAKEN: 'Another order already uses this invoice number, so this invoice was not imported.',
  QB_BAD_INVOICE_NUMBER: 'The invoice number can use only letters, digits and hyphens.',
  QB_BAD_DATE: 'The invoice date could not be read.',
  QB_BAD_CUSTOMER: 'The customer no longer exists.',
  QB_BAD_ACTOR: 'Your login could not be matched to a user, so nothing was changed. Sign in again and retry.',
  QB_BAD_LOCATION: 'The warehouse for this order is not active.',
  QB_BAD_LINES: 'This invoice has no lines that can be imported.',
  QB_BAD_PRODUCT: 'A product on this invoice could not be read.',
  QB_DUPLICATE_PRODUCT: 'A product appears on this invoice more than once.',
  QB_PRODUCT_NOT_FOUND: 'The product map names a product that no longer exists. Ask an administrator to check the map.',
  QB_BAD_QUANTITY: 'A quantity on this invoice is not a whole number above zero.',
  QB_BAD_PRICE: 'A price on this invoice is negative or too large to store.',
  QB_BAD_PACK_SIZE: 'The product map has a pack size that is not a whole number above zero.',
}

const GENERIC_FAILURE = 'This invoice could not be saved, and nothing was changed for it. Try uploading it again.'

function plainMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const code = /\bQB_[A-Z_]+\b/.exec(text)?.[0]
  return (code && CODED_MESSAGES[code]) || GENERIC_FAILURE
}

const REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  picking_started: 'Picking started on this order, so it was not changed. The differences are stored for the office.',
  order_closed: 'This order has moved on, so it was not changed. The differences are stored for the office.',
}

const ADVANCE_MESSAGES: Readonly<Record<string, string>> = {
  CANCELLED: 'This order was cancelled, so it will not go to the Pick Queue.',
  CONFLICT: 'This order moved on while it was being imported. Check it in the order list.',
  NOT_FOUND: 'This order could not be found to move it to the Pick Queue.',
}

const NOT_YET_IN_QUEUE =
  'The order exists but is not in the Pick Queue yet. Upload the same file again to finish it.'

const advanceFailureMessage = (code: string): string => ADVANCE_MESSAGES[code] ?? NOT_YET_IN_QUEUE

const RACE_FLAGGED =
  'Another upload imported this invoice a moment ago with different lines. The order was not changed, and the differences are stored for the office.'

const RACE_NOT_COMPARED =
  'Another upload imported this invoice a moment ago, and its lines could not be compared. Upload the file again to check them.'

const FLAG_NOT_CLEARED = 'This invoice matches its order again, but its old stored differences could not be cleared. Upload the file again to retry.'

// ---------------------------------------------------------------------------
// Parse errors -> rejected verdicts
// ---------------------------------------------------------------------------

const rowReason = (error: QbParseError): string => `Row ${error.rowNumber}: ${error.message}`

/** Groups values by key in first-seen order. The map is local to this call. */
function groupValues<V>(entries: ReadonlyArray<readonly [string, V]>): Map<string, V[]> {
  const groups = new Map<string, V[]>()
  for (const [key, value] of entries) {
    const bucket = groups.get(key)
    if (bucket) bucket.push(value)
    else groups.set(key, [value])
  }
  return groups
}

const reasonsByInvoice = (errors: readonly QbParseError[]): Map<string, string[]> =>
  groupValues(
    errors.flatMap((error): Array<[string, string]> =>
      error.invoiceNumber === null ? [] : [[error.invoiceNumber, rowReason(error)]],
    ),
  )

const rowsByInvoice = (rowInvoice: QbParseResult['rowInvoice']): Map<string, number[]> =>
  groupValues([...rowInvoice.entries()].map(([row, invoice]): [string, number] => [invoice, row]))

/** Applies parse errors to the classifier's verdicts: an invoice with one is rejected,
 *  keeping any reasons the classifier found in its good rows. File order is restored
 *  afterwards because an invoice with no good rows has no classifier verdict. */
function mergeParseErrors(verdicts: readonly InvoiceVerdict[], parsed: QbParseResult, errors: readonly QbParseError[]): InvoiceVerdict[] {
  const parseReasons = reasonsByInvoice(errors)
  const rows = rowsByInvoice(parsed.rowInvoice)
  const byInvoice = new Map(verdicts.map((verdict) => [verdict.invoiceNumber, verdict]))
  const rejected = [...parseReasons.entries()].map(([invoiceNumber, reasons]): InvoiceVerdict => {
    const found = byInvoice.get(invoiceNumber)
    return {
      kind: 'rejected',
      invoiceNumber,
      reasons: [...reasons, ...(found?.kind === 'rejected' ? found.reasons : [])],
      rowNumbers: rows.get(invoiceNumber) ?? [],
    }
  })
  const untouched = verdicts.filter((verdict) => !parseReasons.has(verdict.invoiceNumber))
  return [...untouched, ...rejected].sort((a, b) => a.rowNumbers[0] - b.rowNumbers[0])
}

// ---------------------------------------------------------------------------
// Doubtful rows: a bad value only matters on a line that is ours
// ---------------------------------------------------------------------------

interface Settled {
  /** The parse errors that still count. */
  errors: QbParseError[]
  /** The rows let through, written so the classifier skips them as other lines. */
  otherLines: QbLine[]
  /** Names made up for rows with no product, which no own-product rule may match. */
  madeUpNames: Set<string>
}

const noProductName = (rowNumber: number): string => `row ${rowNumber} (no product)`

function settleDoubtfulRows(parsed: QbParseResult, productMap: readonly ProductMapRow[], isOwn: (name: string) => boolean): Settled {
  const mapped = new Set(productMap.map((row) => normaliseProductName(row.qbName)))
  const isOurs = ({ qbProductName }: QbLine): boolean =>
    qbProductName !== '' && (mapped.has(normaliseProductName(qbProductName)) || isOwn(qbProductName))
  const notOurs = parsed.doubtfulRows.filter((row) => !isOurs(row))
  const forgiven = new Set(notOurs.map((row) => row.rowNumber))
  const otherLines = notOurs.map((row): QbLine => ({
    ...row,
    qbProductName: row.qbProductName === '' ? noProductName(row.rowNumber) : row.qbProductName,
  }))
  return {
    errors: parsed.errors.filter((error) => error.rowNumber === null || !forgiven.has(error.rowNumber)),
    otherLines,
    madeUpNames: new Set(notOurs.filter((row) => row.qbProductName === '').map((row) => noProductName(row.rowNumber))),
  }
}

// ---------------------------------------------------------------------------
// Comparing differences with the stored flag
// ---------------------------------------------------------------------------

/** One text for equal values, whatever the order of their keys or array items. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    return `{${entries.sort().join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/** A rejected invoice names none: nothing from it is imported, and its reasons say why. */
function skippedOf(verdicts: readonly InvoiceVerdict[], lines: readonly QbLine[]): SkippedLine[] {
  const byRow = new Map(lines.map((line) => [line.rowNumber, line]))
  return verdicts.flatMap((verdict) => {
    if (verdict.kind === 'rejected') return []
    const skipped = new Set(verdict.skippedLines)
    return verdict.rowNumbers.flatMap((rowNumber): SkippedLine[] => {
      const name = byRow.get(rowNumber)?.qbProductName
      return name !== undefined && skipped.has(name) ? [{ invoiceNumber: verdict.invoiceNumber, name, rowNumber }] : []
    })
  })
}

function customersOf(lines: readonly QbLine[]): Record<string, string> {
  const named = lines.filter((line) => line.customerName !== '')
  return Object.fromEntries([...named].reverse().map((line) => [line.invoiceNumber, line.customerName]))
}

function countVerdicts(verdicts: readonly InvoiceVerdict[], unattached: number, skipped: number): ImportCounts {
  const countOf = (kind: InvoiceVerdict['kind']): number => verdicts.filter((verdict) => verdict.kind === kind).length
  return {
    added: countOf('add'),
    unchanged: countOf('unchanged'),
    changed: countOf('changed'),
    skipped,
    rejected: countOf('rejected') + unattached,
  }
}

function countResults(results: readonly InvoiceResult[]): ResultCounts {
  const zero: ResultCounts = {
    added: 0,
    updated: 0,
    flagged: 0,
    unchanged: 0,
    finished: 0,
    skipped: 0,
    rejected: 0,
    refused: 0,
    failed: 0,
  }
  return results.reduce((counts, result) => ({ ...counts, [result.outcome]: counts[result.outcome] + 1 }), zero)
}

const isStuck = (stored: StoredImport | undefined): boolean => stored?.orderStatus === 'processing'

// ---------------------------------------------------------------------------
// Acting on one invoice
// ---------------------------------------------------------------------------

interface CommitContext {
  deps: ImportDeps
  storedByInvoice: ReadonlyMap<string, StoredImport>
  flagsByInvoice: ReadonlyMap<string, StoredFlag>
  datesByInvoice: ReadonlyMap<string, string>
  selected: ReadonlySet<string>
}

type AddVerdict = Extract<InvoiceVerdict, { kind: 'add' }>
type ChangedVerdict = Extract<InvoiceVerdict, { kind: 'changed' }>

/** A step that may throw, reported as this invoice's failure. */
async function failingAs(deps: ImportDeps, invoiceNumber: string, orderId: string | undefined, message: (error: unknown) => string, step: () => Promise<InvoiceResult>): Promise<InvoiceResult> {
  try {
    return await step()
  } catch (error) {
    deps.logError?.(invoiceNumber, error)
    return { invoiceNumber, outcome: 'failed', ...(orderId ? { orderId } : {}), message: message(error) }
  }
}

/** Moves the order on and reports `done`, or the failure if it could not. */
function advanceThen(ctx: CommitContext, invoiceNumber: string, orderId: string, done: InvoiceResult): Promise<InvoiceResult> {
  return failingAs(ctx.deps, invoiceNumber, orderId, () => NOT_YET_IN_QUEUE, async () => {
    const advanced = await ctx.deps.advanceToProcessed(orderId)
    if (advanced.ok === true) return done
    return { invoiceNumber, outcome: 'failed', orderId, message: advanceFailureMessage(advanced.code) }
  })
}

async function commitAdd(ctx: CommitContext, verdict: AddVerdict): Promise<InvoiceResult> {
  const { invoiceNumber, horecaId, invoiceDate, lines } = verdict
  const imported = await failingAs(ctx.deps, invoiceNumber, undefined, plainMessage, async () => {
    const tx = await ctx.deps.importInvoice({ invoiceNumber, horecaId, invoiceDate, lines })
    return tx.status === 'created'
      ? { invoiceNumber, outcome: 'added', orderId: tx.orderId }
      : commitRaced(ctx, verdict, tx.orderId)
  })
  if (imported.outcome !== 'added' || !imported.orderId) return imported
  return advanceThen(ctx, invoiceNumber, imported.orderId, imported)
}

/** Our classification found no import, and the transaction found one under its lock.
 *  What this upload holds may differ from what the other one imported, so it is
 *  compared now: flagged if so, rather than lost until the next upload. */
function commitRaced(ctx: CommitContext, verdict: AddVerdict, orderId: string): Promise<InvoiceResult> {
  const { invoiceNumber, horecaId, lines } = verdict
  return failingAs(ctx.deps, invoiceNumber, orderId, () => RACE_NOT_COMPARED, async () => {
    const latest = await ctx.deps.loadStoredImport(invoiceNumber)
    if (!latest) throw new Error(`No import record for ${invoiceNumber} after the transaction reported one`)
    const differences = diffAgainstStored(latest.stored, lines, horecaId)
    if (differences.length === 0) {
      return { invoiceNumber, outcome: 'unchanged', orderId, message: 'Another upload imported this invoice a moment ago.' }
    }
    const flags = new Map(latest.flag ? [[invoiceNumber, latest.flag]] : [])
    return commitFlag({ ...ctx, flagsByInvoice: flags }, { invoiceNumber, orderId, differences }, 'flagged', RACE_FLAGGED)
  })
}

function commitFlag(
  ctx: CommitContext,
  verdict: Pick<ChangedVerdict, 'invoiceNumber' | 'orderId' | 'differences'>,
  outcome: 'flagged' | 'refused',
  message: string,
): Promise<InvoiceResult> {
  const { invoiceNumber, orderId, differences } = verdict
  const stored = ctx.flagsByInvoice.get(invoiceNumber)
  // The same differences again: a flag the office has resolved stays resolved.
  if (stored && canonical(stored.flaggedChange) === canonical(differences)) {
    return Promise.resolve({ invoiceNumber, outcome, orderId, message })
  }
  return failingAs(ctx.deps, invoiceNumber, orderId, plainMessage, async () => {
    await ctx.deps.flagChange(invoiceNumber, differences)
    return { invoiceNumber, outcome, orderId, message }
  })
}

const flaggedMessage = (verdict: ChangedVerdict, stuck: boolean): string => {
  const stored = 'The order was not changed. The differences are stored for the office.'
  if (!stuck) return stored
  return verdict.editable
    ? `${stored} It is not in the Pick Queue yet: select this invoice on the next upload to update and finish it.`
    : `${stored} It is not in the Pick Queue yet.`
}

/** Clears what is stored, then reports `result`, or the failure if it could not. */
function clearingFlag(ctx: CommitContext, invoiceNumber: string, orderId: string | undefined, result: InvoiceResult): Promise<InvoiceResult> {
  return failingAs(ctx.deps, invoiceNumber, orderId, () => FLAG_NOT_CLEARED, async () => {
    await ctx.deps.clearFlag(invoiceNumber)
    return result
  })
}

async function commitApply(ctx: CommitContext, verdict: ChangedVerdict): Promise<InvoiceResult> {
  const { invoiceNumber, orderId, horecaId, lines } = verdict
  // The classifier checked the date on every row of an invoice it did not reject.
  const invoiceDate = ctx.datesByInvoice.get(invoiceNumber) ?? ''
  const applied = await failingAs(ctx.deps, invoiceNumber, orderId, plainMessage, async () => {
    const tx = await ctx.deps.updateInvoice({ invoiceNumber, horecaId, invoiceDate, lines })
    if (tx.status === 'updated') return { invoiceNumber, outcome: 'updated', orderId }
    if (tx.status === 'refused') {
      return { invoiceNumber, outcome: 'refused', orderId, message: REFUSAL_MESSAGES[tx.reason] ?? REFUSAL_MESSAGES.order_closed }
    }
    return { invoiceNumber, outcome: 'failed', orderId, message: GENERIC_FAILURE }
  })
  // It looked editable when classified and stopped being so: the same as not editable.
  if (applied.outcome === 'refused') return commitFlag(ctx, verdict, 'refused', applied.message ?? '')
  if (applied.outcome !== 'updated') return applied
  const moved = isStuck(ctx.storedByInvoice.get(invoiceNumber))
    ? await advanceThen(ctx, invoiceNumber, orderId, applied)
    : applied
  // The transaction clears the flag but not its resolution, which would then sit
  // against an invoice with nothing flagged.
  if (moved.outcome === 'failed' || !ctx.flagsByInvoice.get(invoiceNumber)?.flagResolvedAt) return moved
  return clearingFlag(ctx, invoiceNumber, orderId, moved)
}

function commitChanged(ctx: CommitContext, verdict: ChangedVerdict): Promise<InvoiceResult> {
  if (verdict.editable && ctx.selected.has(verdict.invoiceNumber)) return commitApply(ctx, verdict)
  const stuck = isStuck(ctx.storedByInvoice.get(verdict.invoiceNumber))
  return commitFlag(ctx, verdict, 'flagged', flaggedMessage(verdict, stuck))
}

async function commitUnchanged(ctx: CommitContext, invoiceNumber: string): Promise<InvoiceResult> {
  const stored = ctx.storedByInvoice.get(invoiceNumber)
  const orderId = stored?.orderId
  const result: InvoiceResult =
    stored && isStuck(stored)
      ? await advanceThen(ctx, invoiceNumber, stored.orderId, { invoiceNumber, outcome: 'finished', orderId: stored.orderId })
      : { invoiceNumber, outcome: 'unchanged', ...(orderId ? { orderId } : {}) }
  if (result.outcome === 'failed' || !ctx.flagsByInvoice.has(invoiceNumber)) return result
  return clearingFlag(ctx, invoiceNumber, orderId, result)
}

function commitVerdict(ctx: CommitContext, verdict: InvoiceVerdict): Promise<InvoiceResult> | InvoiceResult {
  const { invoiceNumber } = verdict
  switch (verdict.kind) {
    case 'add':
      return commitAdd(ctx, verdict)
    case 'changed':
      return commitChanged(ctx, verdict)
    case 'unchanged':
      return commitUnchanged(ctx, invoiceNumber)
    case 'no_mapped_lines':
      return { invoiceNumber, outcome: 'skipped' }
    case 'rejected':
      return { invoiceNumber, outcome: 'rejected', message: verdict.reasons.join('; ') }
  }
}

/** One at a time and in file order: each invoice holds its own locks and stock
 *  reservations, and the earlier line in the file gets first call on short stock. */
async function commitAll(ctx: CommitContext, verdicts: readonly InvoiceVerdict[]): Promise<InvoiceResult[]> {
  const results: InvoiceResult[] = []
  for (const verdict of verdicts) results.push(await commitVerdict(ctx, verdict))
  return results
}

function ignoredSelections(selected: ReadonlySet<string>, verdicts: readonly InvoiceVerdict[]): IgnoredSelection[] {
  const byInvoice = new Map(verdicts.map((verdict) => [verdict.invoiceNumber, verdict]))
  return [...selected].flatMap((invoiceNumber): IgnoredSelection[] => {
    const verdict = byInvoice.get(invoiceNumber)
    if (!verdict) return [{ invoiceNumber, reason: 'This invoice is not in the file.' }]
    if (verdict.kind !== 'changed') return [{ invoiceNumber, reason: 'This invoice has no change to apply.' }]
    return verdict.editable ? [] : [{ invoiceNumber, reason: 'This order can no longer be edited.' }]
  })
}

// ---------------------------------------------------------------------------
// The two actions
// ---------------------------------------------------------------------------

function firstDates(lines: readonly QbLine[]): Map<string, string> {
  return new Map([...lines].reverse().map((line) => [line.invoiceNumber, line.invoiceDate]))
}

function fileRefusal(action: ImportRequest['action'], errors: readonly QbParseError[]): ImportOk {
  return {
    status: 'ok',
    action,
    counts: { added: 0, unchanged: 0, changed: 0, skipped: 0, rejected: 0 },
    verdicts: [],
    fileErrors: errors.map((error) => error.message),
    unattachedRowErrors: [],
    skippedLines: [],
    unfinishedInvoices: [],
    staleFlagInvoices: [],
    invoiceCustomers: {},
  }
}

/** Reads the facts and works out the verdicts. The one path both actions take. */
async function assess(parsed: QbParseResult, deps: ImportDeps) {
  const facts = await deps.loadFacts([...new Set(parsed.rowInvoice.values())])
  const isOwn = buildOwnProductRule(facts.ownProductPrefixes, facts.ownProductTerms)
  const { errors, otherLines, madeUpNames } = settleDoubtfulRows(parsed, facts.productMap, isOwn)
  const lines = [...parsed.lines, ...otherLines].sort((a, b) => a.rowNumber - b.rowNumber)
  const classified = classifyInvoices(lines, {
    customers: facts.customers,
    productMap: facts.productMap,
    storedImports: facts.storedImports,
    isOwnProductName: (name) => !madeUpNames.has(name) && isOwn(name),
  })
  return {
    lines,
    verdicts: mergeParseErrors(classified, parsed, errors),
    storedByInvoice: new Map(facts.storedImports.map((stored) => [stored.invoiceNumber, stored])),
    flagsByInvoice: new Map(facts.storedFlags.map((flag) => [flag.invoiceNumber, flag])),
  }
}

export async function runImport(request: ImportRequest, deps: ImportDeps): Promise<ImportResponse> {
  if (!ALLOWED_ROLES.includes(request.actorRole)) {
    return { status: 'forbidden', message: 'Only an Admin or Manager can import invoices.' }
  }

  const parsed = parseInvoices(request.csvText)
  const refusals = parsed.errors.filter((error) => error.rowNumber === null)
  if (refusals.length > 0) return fileRefusal(request.action, refusals)

  const { lines, verdicts, storedByInvoice, flagsByInvoice } = await assess(parsed, deps)
  const unattachedRowErrors = parsed.errors.filter((error) => error.invoiceNumber === null)
  const skippedLines = skippedOf(verdicts, lines)
  const unchanged = verdicts.filter((verdict) => verdict.kind === 'unchanged').map((verdict) => verdict.invoiceNumber)
  const summary: ImportOk = {
    status: 'ok',
    action: request.action,
    counts: countVerdicts(verdicts, unattachedRowErrors.length, skippedLines.length),
    verdicts,
    fileErrors: [],
    unattachedRowErrors,
    skippedLines,
    unfinishedInvoices: unchanged.filter((invoiceNumber) => isStuck(storedByInvoice.get(invoiceNumber))),
    staleFlagInvoices: unchanged.filter((invoiceNumber) => flagsByInvoice.has(invoiceNumber)),
    invoiceCustomers: customersOf(lines),
  }
  if (request.action === 'preview') return summary

  const selected = new Set(request.applyChanges ?? [])
  const results = await commitAll(
    { deps, storedByInvoice, flagsByInvoice, datesByInvoice: firstDates(parsed.lines), selected },
    verdicts,
  )
  return { ...summary, results, resultCounts: countResults(results), ignoredApplyChanges: ignoredSelections(selected, verdicts) }
}
