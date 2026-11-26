// The shape of a saved New Order draft, and the one validator for it.
//
// PURE and dependency-free, because BOTH runtimes import it: `mutate-order-draft`
// (Deno) refuses a body this rejects, and the New Order screen (Vite) builds the
// body from the same `DraftLine` type. Zod is deliberately not used — the Deno
// side imports it from a URL, which the frontend and vitest cannot load.
//
// A draft is work in progress, so it is deliberately looser than an order:
// no customer yet, no lines yet and a quantity of 0 (a box the operator has
// cleared mid-edit) are all legal here. `place-order` is where an order has to
// be complete.

/** One line of a draft or an order being keyed: a quantity in the chosen unit. */
export interface DraftLine {
  productId: number
  /** `product_uoms.id`; null = the product's base unit. */
  uomId: number | null
  /** In the chosen unit, not base units. */
  quantity: number
}

export interface OrderDraftUpsert {
  action: 'upsert'
  /** null creates a draft; a uuid updates that one. */
  id: string | null
  hoReCaId: number | null
  lines: DraftLine[]
  /** `YYYY-MM-DD`, or null when no date has been agreed. */
  deliveryDate: string | null
  notes: string | null
}

export interface OrderDraftDelete {
  action: 'delete'
  id: string
}

export type OrderDraftRequest = OrderDraftUpsert | OrderDraftDelete

/**
 * Not a discriminated union on purpose: the frontend's tsconfig runs with
 * `strict` off, where narrowing on a boolean `ok` does not happen, so callers
 * read `value` / `error` directly after checking `ok`.
 */
export interface ParseResult<T> {
  ok: boolean
  value?: T
  error?: string
}

export const MAX_DRAFT_LINES = 500
export const MAX_DRAFT_NOTES = 2000
const MAX_QUANTITY = 1_000_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0

const fail = (error: string): ParseResult<never> => ({ ok: false, error })

function parseLine(raw: unknown, index: number): ParseResult<DraftLine> {
  const at = `lines[${index}]`
  if (!isRecord(raw)) return fail(`${at} must be an object`)
  if (!isPositiveInt(raw.productId)) return fail(`${at}.productId must be a positive integer`)
  const uomId = raw.uomId ?? null
  if (uomId !== null && !isPositiveInt(uomId)) return fail(`${at}.uomId must be a positive integer or null`)
  const q = raw.quantity
  if (!Number.isInteger(q) || (q as number) < 0 || (q as number) > MAX_QUANTITY) {
    return fail(`${at}.quantity must be a whole number from 0 to ${MAX_QUANTITY}`)
  }
  return { ok: true, value: { productId: raw.productId, uomId: uomId as number | null, quantity: q as number } }
}

function parseUpsert(body: Record<string, unknown>): ParseResult<OrderDraftUpsert> {
  const id = body.id ?? null
  if (id !== null && (typeof id !== 'string' || !UUID.test(id))) return fail('id must be a uuid or null')

  const hoReCaId = body.hoReCaId ?? null
  if (hoReCaId !== null && !isPositiveInt(hoReCaId)) return fail('hoReCaId must be a positive integer or null')

  if (!Array.isArray(body.lines)) return fail('lines must be an array')
  if (body.lines.length > MAX_DRAFT_LINES) return fail(`a draft holds at most ${MAX_DRAFT_LINES} lines`)
  const lines: DraftLine[] = []
  for (let i = 0; i < body.lines.length; i++) {
    const parsed = parseLine(body.lines[i], i)
    if (!parsed.ok || !parsed.value) return fail(parsed.error ?? `lines[${i}] is invalid`)
    lines.push(parsed.value)
  }

  const deliveryDate = body.deliveryDate ?? null
  if (deliveryDate !== null && (typeof deliveryDate !== 'string' || !ISO_DATE.test(deliveryDate))) {
    return fail('deliveryDate must be YYYY-MM-DD or null')
  }

  const notes = body.notes ?? null
  if (notes !== null && typeof notes !== 'string') return fail('notes must be text or null')
  if (typeof notes === 'string' && notes.length > MAX_DRAFT_NOTES) {
    return fail(`notes must be at most ${MAX_DRAFT_NOTES} characters`)
  }

  return {
    ok: true,
    value: {
      action: 'upsert',
      id: id as string | null,
      hoReCaId: hoReCaId as number | null,
      lines,
      deliveryDate: deliveryDate as string | null,
      notes: notes as string | null,
    },
  }
}

/** Validate a `mutate-order-draft` request body. Never throws. */
export function parseOrderDraftRequest(body: unknown): ParseResult<OrderDraftRequest> {
  if (!isRecord(body)) return fail('body must be a JSON object')
  if (body.action === 'upsert') return parseUpsert(body)
  if (body.action === 'delete') {
    if (typeof body.id !== 'string' || !UUID.test(body.id)) return fail('id must be a uuid')
    return { ok: true, value: { action: 'delete', id: body.id } }
  }
  return fail("action must be 'upsert' or 'delete'")
}
