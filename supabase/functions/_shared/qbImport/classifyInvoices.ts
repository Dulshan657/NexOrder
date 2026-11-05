// What happens to each invoice in a QuickBooks upload, decided before anything is written.
//
// `classifyInvoices` takes the parsed rows and the facts the caller has already
// read (customers, the product map, invoices imported before) and returns ONE
// verdict per invoice number, in the order the invoices first appear. The upload
// preview shows the verdicts; a later change acts on them.
//
// Every verdict carries `rowNumbers`: all the input rows that invoice accounts
// for. Across the verdicts each input row appears exactly once.
//
// PURITY: no platform globals, no I/O, no clock, no randomness, and no imports
// but types. Inputs are never changed. Which unmapped product names belong to
// the tenant is NOT decided here: the caller passes `isOwnProductName`, so no
// brand or tenant check lives in shared code.
//
// MATCHING: names are compared after `normaliseName` and nothing else. Spacing
// and case are ignored; punctuation and spelling are not. Nothing is fuzzy-matched,
// because a wrong guess here puts a real order on the wrong customer or product.

import type { QbLine } from './types.ts'

export interface ClassifyCustomer {
  id: number
  name: string
}

export interface ProductMapRow {
  qbName: string
  productId: number
  packSize: number | null
}

export interface StoredLine {
  productId: number
  quantity: number
  unitPrice: number
}

export interface StoredImport {
  invoiceNumber: string
  orderId: string
  horecaId: number
  lines: StoredLine[]
  pickingStarted: boolean
  orderStatus: string
}

export interface ClassifyContext {
  customers: ClassifyCustomer[]
  productMap: ProductMapRow[]
  storedImports: StoredImport[]
  /** The tenant's rule for "this unmapped name is one of our products". */
  isOwnProductName: (name: string) => boolean
}

export interface MappedLine {
  productId: number
  quantity: number
  packSize: number | null
  unitPrice: number
  qbProductName: string
}

export type InvoiceDifference =
  | { kind: 'added'; productId: number; qbProductName: string; quantity: number; unitPrice: number }
  | { kind: 'removed'; productId: number; quantity: number; unitPrice: number }
  | {
      kind: 'altered'
      productId: number
      qbProductName: string
      from: { quantity: number; unitPrice: number }
      to: { quantity: number; unitPrice: number }
    }
  | { kind: 'customer'; fromHorecaId: number; toHorecaId: number }

export type InvoiceVerdict =
  | {
      kind: 'add'
      invoiceNumber: string
      invoiceDate: string
      horecaId: number
      lines: MappedLine[]
      skippedLines: string[]
      rowNumbers: number[]
    }
  | { kind: 'unchanged'; invoiceNumber: string; skippedLines: string[]; rowNumbers: number[] }
  | {
      kind: 'changed'
      invoiceNumber: string
      orderId: string
      horecaId: number
      lines: MappedLine[]
      differences: InvoiceDifference[]
      editable: boolean
      skippedLines: string[]
      rowNumbers: number[]
    }
  | { kind: 'no_mapped_lines'; invoiceNumber: string; skippedLines: string[]; rowNumbers: number[] }
  | { kind: 'rejected'; invoiceNumber: string; reasons: string[]; rowNumbers: number[] }

const INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/

/** An order can still be rewritten from a changed invoice only while it is in
 *  one of these states and nobody has started picking it. */
const EDITABLE_ORDER_STATUSES: readonly string[] = ['processing', 'processed']

/** The one comparison used for customer and product names: trim, collapse inner
 *  whitespace to one space, fold case. Punctuation is kept. */
export function normaliseName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const toCents = (price: number): number => Math.round(price * 100)

const quote = (text: string): string => `"${text.trim()}"`

/** Groups items by key. Groups and their members keep first-seen order. */
function groupInOrder<T, K>(items: readonly T[], keyOf: (item: T) => K): T[][] {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = groups.get(key)
    if (bucket) bucket.push(item)
    else groups.set(key, [item])
  }
  return [...groups.values()]
}

/** Drops later items that share a key with an earlier one. */
function uniqueBy<T, K>(items: readonly T[], keyOf: (item: T) => K): T[] {
  return groupInOrder(items, keyOf).map((group) => group[0])
}

function indexBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  return new Map(groupInOrder(items, keyOf).map((group) => [keyOf(group[0]), group]))
}

// ---------------------------------------------------------------------------
// Lookups built once per call
// ---------------------------------------------------------------------------

interface Lookups {
  products: Map<string, ProductMapRow[]>
  customers: Map<string, ClassifyCustomer[]>
  stored: Map<string, StoredImport>
  isOwnProductName: (name: string) => boolean
}

function buildLookups(ctx: ClassifyContext): Lookups {
  return {
    products: indexBy(ctx.productMap, (row) => normaliseName(row.qbName)),
    customers: indexBy(ctx.customers, (customer) => normaliseName(customer.name)),
    stored: new Map(ctx.storedImports.map((entry) => [entry.invoiceNumber, entry])),
    isOwnProductName: ctx.isOwnProductName,
  }
}

// ---------------------------------------------------------------------------
// Splitting an invoice's lines
// ---------------------------------------------------------------------------

/** A line that names a row of the product map. More than one row means the map
 *  is ambiguous for that name; the line is kept so it can be rejected by name. */
interface MappedCandidate {
  line: QbLine
  rows: ProductMapRow[]
}

interface Partition {
  mapped: MappedCandidate[]
  ownUnmapped: QbLine[]
  other: QbLine[]
}

function partitionLines(group: readonly QbLine[], lookups: Lookups): Partition {
  const tagged = group.map((line) => {
    const rows = lookups.products.get(normaliseName(line.qbProductName)) ?? []
    const isOwn = rows.length === 0 && lookups.isOwnProductName(line.qbProductName)
    return { line, rows, isOwn }
  })
  return {
    mapped: tagged.filter((t) => t.rows.length > 0).map(({ line, rows }) => ({ line, rows })),
    ownUnmapped: tagged.filter((t) => t.isOwn).map((t) => t.line),
    other: tagged.filter((t) => t.rows.length === 0 && !t.isOwn).map((t) => t.line),
  }
}

// ---------------------------------------------------------------------------
// Rejection reasons. Each helper returns every reason it finds, never just one.
// ---------------------------------------------------------------------------

const lineLabel = (line: QbLine): string => `${quote(line.qbProductName)} (row ${line.rowNumber})`

function invoiceNumberReasons(invoiceNumber: string): string[] {
  return INVOICE_NUMBER_PATTERN.test(invoiceNumber)
    ? []
    : [`Invoice number ${quote(invoiceNumber)} must use only letters, digits and hyphens between them`]
}

function dateReasons(group: readonly QbLine[]): string[] {
  const dates = uniqueBy(
    group.map((line) => line.invoiceDate.trim()),
    (date) => date,
  )
  return dates.length > 1 ? [`Lines have more than one invoice date: ${dates.map(quote).join(', ')}`] : []
}

function customerMatchReasons(customer: { key: string; written: string }, lookups: Lookups): string[] {
  // A blank name is the absence of a name, so it is never looked up, even if a
  // customer row has a blank name too.
  if (customer.key === '') return ['Customer name is blank']
  const matches = lookups.customers.get(customer.key) ?? []
  if (matches.length === 0) return [`Customer ${quote(customer.written)} is not in the customer list`]
  if (matches.length > 1) {
    const ids = matches.map((match) => `#${match.id}`).join(', ')
    return [`Customer ${quote(customer.written)} matches more than one customer (${ids})`]
  }
  return []
}

function customerReasons(group: readonly QbLine[], lookups: Lookups): string[] {
  const customers = uniqueBy(
    group.map((line) => ({ key: normaliseName(line.customerName), written: line.customerName.trim() })),
    (customer) => customer.key,
  )
  const mixed =
    customers.length > 1
      ? [`Lines name more than one customer: ${customers.map((c) => quote(c.written)).join(', ')}`]
      : []
  return [...mixed, ...customers.flatMap((customer) => customerMatchReasons(customer, lookups))]
}

function lineValueReasons(mapped: readonly MappedCandidate[]): string[] {
  return mapped.flatMap(({ line }) => [
    ...(Number.isSafeInteger(line.quantity) && line.quantity > 0
      ? []
      : [`${lineLabel(line)}: quantity ${line.quantity} is not a positive whole number`]),
    ...(Number.isFinite(line.unitPrice) && line.unitPrice >= 0
      ? []
      : [`${lineLabel(line)}: unit price ${line.unitPrice} is negative or not a number`]),
  ])
}

interface Aggregate {
  lines: MappedLine[]
  reasons: string[]
}

/** Adds up the lines of one product. One product at two prices, or under two
 *  names with different pack sizes, is a reason, never an average. */
function aggregateProduct(entries: readonly MappedCandidate[]): { line: MappedLine; reasons: string[] } {
  const first = entries[0]
  const row = first.rows[0]
  const pricedLines = entries.filter(({ line }) => Number.isFinite(line.unitPrice))
  const prices = uniqueBy(pricedLines, ({ line }) => toCents(line.unitPrice))
  const sizes = uniqueBy(entries, ({ rows }) => rows[0].packSize)
  const names = uniqueBy(entries, ({ line }) => line.qbProductName)
  const reasons = [
    ...(prices.length > 1
      ? [`${quote(first.line.qbProductName)} appears at ${prices.length} prices: ${prices.map((p) => p.line.unitPrice).join(', ')}`]
      : []),
    ...(sizes.length > 1
      ? [`${names.map(({ line }) => quote(line.qbProductName)).join(' and ')} are one product with different pack sizes`]
      : []),
  ]
  const line: MappedLine = {
    productId: row.productId,
    quantity: entries.reduce((sum, entry) => sum + entry.line.quantity, 0),
    packSize: row.packSize,
    unitPrice: first.line.unitPrice,
    qbProductName: first.line.qbProductName,
  }
  return { line, reasons }
}

function aggregateMapped(mapped: readonly MappedCandidate[]): Aggregate {
  const resolvable = mapped.filter(({ rows }) => rows.length === 1)
  const results = groupInOrder(resolvable, ({ rows }) => rows[0].productId).map(aggregateProduct)
  return { lines: results.map((r) => r.line), reasons: results.flatMap((r) => r.reasons) }
}

function ambiguousMapReasons(mapped: readonly MappedCandidate[]): string[] {
  return mapped
    .filter(({ rows }) => rows.length > 1)
    .map(({ line }) => `${lineLabel(line)} matches more than one row of the product map`)
}

function ownUnmappedReasons(ownUnmapped: readonly QbLine[]): string[] {
  return ownUnmapped.map((line) => `${lineLabel(line)} is one of our products but is not in the product map`)
}

// ---------------------------------------------------------------------------
// Comparing with what was imported before
// ---------------------------------------------------------------------------

function storedByProduct(stored: StoredImport): StoredLine[] {
  return groupInOrder(stored.lines, (line) => line.productId).map((group) => ({
    productId: group[0].productId,
    quantity: group.reduce((sum, line) => sum + line.quantity, 0),
    unitPrice: group[0].unitPrice,
  }))
}

function lineDifference(line: MappedLine, before: StoredLine | undefined): InvoiceDifference[] {
  if (!before) {
    const { productId, qbProductName, quantity, unitPrice } = line
    return [{ kind: 'added', productId, qbProductName, quantity, unitPrice }]
  }
  if (before.quantity === line.quantity && toCents(before.unitPrice) === toCents(line.unitPrice)) return []
  return [
    {
      kind: 'altered',
      productId: line.productId,
      qbProductName: line.qbProductName,
      from: { quantity: before.quantity, unitPrice: before.unitPrice },
      to: { quantity: line.quantity, unitPrice: line.unitPrice },
    },
  ]
}

function diffAgainstStored(stored: StoredImport, lines: readonly MappedLine[], horecaId: number): InvoiceDifference[] {
  const before = storedByProduct(stored)
  const beforeById = new Map(before.map((line) => [line.productId, line]))
  const nowIds = new Set(lines.map((line) => line.productId))
  const changedLines = lines.flatMap((line) => lineDifference(line, beforeById.get(line.productId)))
  const removed: InvoiceDifference[] = before
    .filter((line) => !nowIds.has(line.productId))
    .map(({ productId, quantity, unitPrice }) => ({ kind: 'removed', productId, quantity, unitPrice }))
  const customer: InvoiceDifference[] =
    stored.horecaId === horecaId ? [] : [{ kind: 'customer', fromHorecaId: stored.horecaId, toHorecaId: horecaId }]
  return [...changedLines, ...removed, ...customer]
}

const isEditable = (stored: StoredImport): boolean =>
  !stored.pickingStarted && EDITABLE_ORDER_STATUSES.includes(stored.orderStatus)

// ---------------------------------------------------------------------------
// One invoice
// ---------------------------------------------------------------------------

/** What every verdict for the invoice repeats. */
interface InvoiceFacts {
  invoiceNumber: string
  invoiceDate: string
  rowNumbers: number[]
  skippedLines: string[]
}

function existingInvoiceVerdict(
  stored: StoredImport,
  facts: InvoiceFacts,
  lines: MappedLine[],
  horecaId: number,
): InvoiceVerdict {
  const { invoiceNumber, rowNumbers, skippedLines } = facts
  const differences = diffAgainstStored(stored, lines, horecaId)
  if (differences.length === 0) return { kind: 'unchanged', invoiceNumber, skippedLines, rowNumbers }
  return {
    kind: 'changed',
    invoiceNumber,
    orderId: stored.orderId,
    horecaId,
    lines,
    differences,
    editable: isEditable(stored),
    skippedLines,
    rowNumbers,
  }
}

/** The mapped lines of an invoice already imported have all gone from the file.
 *  That is a change to report, never one to ignore, and it is never editable. */
function allMappedLinesGone(stored: StoredImport, facts: InvoiceFacts): InvoiceVerdict {
  return {
    kind: 'changed',
    invoiceNumber: facts.invoiceNumber,
    orderId: stored.orderId,
    horecaId: stored.horecaId,
    lines: [],
    differences: diffAgainstStored(stored, [], stored.horecaId),
    editable: false,
    skippedLines: facts.skippedLines,
    rowNumbers: facts.rowNumbers,
  }
}

function classifyInvoice(group: readonly QbLine[], lookups: Lookups): InvoiceVerdict {
  const invoiceNumber = group[0].invoiceNumber
  const parts = partitionLines(group, lookups)
  const facts: InvoiceFacts = {
    invoiceNumber,
    invoiceDate: group[0].invoiceDate.trim(),
    rowNumbers: group.map((line) => line.rowNumber),
    skippedLines: parts.other.map((line) => line.qbProductName),
  }
  const stored = lookups.stored.get(invoiceNumber)

  // Nothing here is ours: no customer, date, number or value check may reject it.
  if (parts.mapped.length === 0 && parts.ownUnmapped.length === 0) {
    if (stored) return allMappedLinesGone(stored, facts)
    return { kind: 'no_mapped_lines', invoiceNumber, skippedLines: facts.skippedLines, rowNumbers: facts.rowNumbers }
  }

  const aggregate = aggregateMapped(parts.mapped)
  const reasons = [
    ...invoiceNumberReasons(invoiceNumber),
    ...customerReasons(group, lookups),
    ...dateReasons(group),
    ...ownUnmappedReasons(parts.ownUnmapped),
    ...ambiguousMapReasons(parts.mapped),
    ...lineValueReasons(parts.mapped),
    ...aggregate.reasons,
  ]
  if (reasons.length > 0) return { kind: 'rejected', invoiceNumber, reasons, rowNumbers: facts.rowNumbers }

  // No reason means exactly one customer, with exactly one match.
  const horecaId = lookups.customers.get(normaliseName(group[0].customerName))[0].id
  if (stored) return existingInvoiceVerdict(stored, facts, aggregate.lines, horecaId)
  return {
    kind: 'add',
    invoiceNumber,
    invoiceDate: facts.invoiceDate,
    horecaId,
    lines: aggregate.lines,
    skippedLines: facts.skippedLines,
    rowNumbers: facts.rowNumbers,
  }
}

/** One verdict per invoice number, in the order the invoices first appear. */
export function classifyInvoices(lines: readonly QbLine[], ctx: ClassifyContext): InvoiceVerdict[] {
  const lookups = buildLookups(ctx)
  return groupInOrder(lines, (line) => line.invoiceNumber).map((group) => classifyInvoice(group, lookups))
}
