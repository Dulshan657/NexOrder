// The database side of `runImport`: each thing it asks for, as a Supabase call.
//
// Runs as the service role, because qb_product_map, qb_invoice_imports and both
// transactions are closed to every client role (mig 00139).
//
// NOTHING HERE MAY STOP AT PostgREST's DEFAULT 1000 ROWS. A customer or map row
// missing from a read would turn a good invoice into a rejected or skipped one, so
// every read that can exceed a page walks all its pages.

// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { ensureProcessedFulfilments, writeProcessedStatus } from '../fulfillment.ts'
import type { InvoiceDifference, MappedLine, StoredImport, StoredLine } from './classifyInvoices.ts'
import type { AdvanceResult, ImportDeps, ImportFacts, ImportTxResult, InvoiceWrite, UpdateTxResult } from './runImport.ts'

const PAGE_SIZE = 1000
/** Keeps an `.in(...)` list short enough for the request URL. */
const IN_CHUNK = 200

const STATUS_NOTE = 'Imported from a QuickBooks invoice'

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))
}

/** Every row of a query, however many pages it takes. The query must be ordered. */
async function fetchAll(what: string, pageOf: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await pageOf(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Reading ${what} failed: ${error.message}`)
    const page = (data ?? []) as any[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

async function fetchInChunks(what: string, values: readonly string[], pageOf: (chunk: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<any[]> {
  const pages: any[][] = []
  for (const chunk of chunksOf(values, IN_CHUNK)) {
    pages.push(await fetchAll(what, (from, to) => pageOf(chunk, from, to)))
  }
  return pages.flat()
}

const toStoredLine = (line: any): StoredLine => ({
  productId: Number(line.product_id),
  quantity: Number(line.quantity),
  unitPrice: Number(line.unit_price),
})

async function loadStoredImports(admin: SupabaseClient, invoiceNumbers: readonly string[]): Promise<StoredImport[]> {
  const imports = await fetchInChunks('earlier imports', invoiceNumbers, (chunk, from, to) =>
    admin.from('qb_invoice_imports').select('invoice_number, order_id, lines').in('invoice_number', chunk).order('invoice_number').range(from, to),
  )
  const orderIds = imports.map((row) => row.order_id as string)
  const [orders, picks] = await Promise.all([
    fetchInChunks('imported orders', orderIds, (chunk, from, to) =>
      admin.from('orders').select('id, status, horeca_id').in('id', chunk).order('id').range(from, to),
    ),
    fetchInChunks('pick progress', orderIds, (chunk, from, to) =>
      admin.from('pick_progress').select('order_id').in('order_id', chunk).order('id').range(from, to),
    ),
  ])
  const orderById = new Map(orders.map((order) => [order.id as string, order]))
  const picked = new Set(picks.map((pick) => pick.order_id as string))
  return imports.map((row): StoredImport => {
    const order = orderById.get(row.order_id)
    return {
      invoiceNumber: row.invoice_number,
      orderId: row.order_id,
      horecaId: Number(order?.horeca_id),
      lines: (Array.isArray(row.lines) ? row.lines : []).map(toStoredLine),
      pickingStarted: picked.has(row.order_id),
      orderStatus: String(order?.status),
    }
  })
}

async function loadOwnProductRule(admin: SupabaseClient): Promise<Pick<ImportFacts, 'ownProductPrefixes' | 'ownProductTerms'>> {
  const { data, error } = await admin
    .from('app_settings')
    .select('qb_own_product_prefixes, qb_own_product_terms')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(`Reading the own-product rule failed: ${error.message}`)
  return {
    ownProductPrefixes: ((data as any)?.qb_own_product_prefixes ?? []) as string[],
    ownProductTerms: ((data as any)?.qb_own_product_terms ?? []) as string[],
  }
}

async function loadFacts(admin: SupabaseClient, invoiceNumbers: readonly string[]): Promise<ImportFacts> {
  const [customers, productMap, storedImports, rule] = await Promise.all([
    fetchAll('customers', (from, to) => admin.from('horecas').select('id, name').order('id').range(from, to)),
    fetchAll('the product map', (from, to) =>
      admin.from('qb_product_map').select('qb_name, product_id, pack_size').order('qb_name').range(from, to),
    ),
    loadStoredImports(admin, invoiceNumbers),
    loadOwnProductRule(admin),
  ])
  return {
    customers: customers.map((row) => ({ id: row.id, name: row.name })),
    productMap: productMap.map((row) => ({ qbName: row.qb_name, productId: row.product_id, packSize: row.pack_size })),
    storedImports,
    ...rule,
  }
}

const toTxLine = ({ productId, quantity, packSize, unitPrice }: MappedLine) => ({
  product_id: productId,
  quantity,
  pack_size: packSize,
  unit_price: unitPrice,
})

async function callInvoiceTx(admin: SupabaseClient, name: string, write: InvoiceWrite, actorId: string): Promise<any> {
  const { data, error } = await admin.rpc(name, {
    p_invoice_number: write.invoiceNumber,
    p_horeca_id: write.horecaId,
    p_invoice_date: write.invoiceDate,
    p_lines: write.lines.map(toTxLine),
    p_actor: actorId,
    p_location_pref: null,
  })
  if (error) throw new Error(error.message)
  return data
}

async function importInvoice(admin: SupabaseClient, write: InvoiceWrite, actorId: string): Promise<ImportTxResult> {
  const data = await callInvoiceTx(admin, 'qb_import_invoice_tx', write, actorId)
  return { status: data.status, orderId: data.order_id }
}

async function updateInvoice(admin: SupabaseClient, write: InvoiceWrite, actorId: string): Promise<UpdateTxResult> {
  const data = await callInvoiceTx(admin, 'qb_update_invoice_tx', write, actorId)
  if (data.status === 'updated') return { status: 'updated', orderId: data.order_id }
  if (data.status === 'refused') return { status: 'refused', reason: data.reason }
  return { status: 'not_found' }
}

/** A new flag is an open flag, even if the office had resolved an earlier one. */
async function flagChange(admin: SupabaseClient, invoiceNumber: string, differences: InvoiceDifference[]): Promise<void> {
  const { data, error } = await admin
    .from('qb_invoice_imports')
    .update({ flagged_change: differences, flag_resolved_at: null } as any)
    .eq('invoice_number', invoiceNumber)
    .select('invoice_number')
  if (error) throw new Error(`Storing the differences for ${invoiceNumber} failed: ${error.message}`)
  if (!data || data.length === 0) throw new Error(`No import record for ${invoiceNumber}`)
}

/** `ensureFulfillments` does not report a failed write, and an order at `processed`
 *  with no fulfilment can never be picked and would not be retried. So the rows are
 *  read back before the status moves, and a missing one leaves the order at
 *  `processing` for the next upload to finish. */
async function advanceToProcessed(admin: SupabaseClient, orderId: string, actorId: string): Promise<AdvanceResult> {
  const stampIso = new Date().toISOString()
  await ensureProcessedFulfilments(admin, orderId, actorId, stampIso)
  const { count, error } = await admin
    .from('order_fulfillments')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
  if (error || !count) return { ok: false, code: 'NO_FULFILMENT' }
  const verdict = await writeProcessedStatus(admin, { orderId, actorId, stampIso, note: STATUS_NOTE })
  return verdict.ok === true ? { ok: true } : { ok: false, code: verdict.code }
}

export function buildImportDeps(admin: SupabaseClient, actorId: string): ImportDeps {
  return {
    loadFacts: (invoiceNumbers) => loadFacts(admin, invoiceNumbers),
    importInvoice: (write) => importInvoice(admin, write, actorId),
    updateInvoice: (write) => updateInvoice(admin, write, actorId),
    flagChange: (invoiceNumber, differences) => flagChange(admin, invoiceNumber, differences),
    advanceToProcessed: (orderId) => advanceToProcessed(admin, orderId, actorId),
    logError: (invoiceNumber, error) =>
      console.error(`[import-qb-invoices] ${invoiceNumber}: ${error instanceof Error ? error.message : String(error)}`),
  }
}
