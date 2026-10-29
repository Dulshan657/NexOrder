// What a voice tool is allowed to look at, and what it hands back.
//
// The context is a SNAPSHOT of data the app already holds in its TanStack cache
// for the signed-in user: no tool queries anything, so what a rep can ask about
// is exactly what RLS already let them load. It is read-only by type and by
// convention (the tests deep-freeze it), and the clock arrives as `now`, never
// from the system, so every answer is reproducible.
//
// IDS. `Order.submittedBy.id`, `Visit.userId` and `SalesTarget.userId` are the
// frontend's NUMERIC hashes of a profile uuid (lib/profileToUser.ts). `user.uuid`
// is the real auth id; it is carried for the session, and NEVER compared against
// any of those fields. Whose figures a tool returns is decided by `numericId`.

import type { MetricContext } from '@/lib/semantic'
import type { HoReCa, Order, Product, SalesTarget, ScheduledVisit, Visit } from '@/types'

export interface VoiceToolUser {
  /** The frontend's numeric id (hash of the uuid). The only id tools compare. */
  readonly numericId: number
  /** The auth uuid. Not used to scope data. */
  readonly uuid: string
  readonly role: string
  readonly name: string
}

export interface VoiceToolContext {
  readonly orders: readonly Order[]
  readonly products: readonly Product[]
  readonly hoReCas: readonly HoReCa[]
  readonly salesTargets: readonly SalesTarget[]
  readonly visits: readonly Visit[]
  readonly routes: readonly ScheduledVisit[]
  readonly settings: { readonly lowStockThreshold: number }
  /** The instant the question is answered at. Tools never read the system clock. */
  readonly now: Date
  readonly user: VoiceToolUser
  /** Enabled module slugs, built where the context is made from the folded MODULE_* constants. */
  readonly modules: readonly string[]
}

/** What a tool implementation returns; runVoiceTool adds `asOf` and the size cap. */
export type ToolOutcome =
  | { readonly ok: true; readonly basis: string; readonly data: unknown }
  | { readonly ok: false; readonly error: string }

/**
 * What the model is given back. `basis` says what the figures rest on (period,
 * whose orders, which rule) and `asOf` when they were computed; the assistant is
 * instructed to state the basis with every answer.
 */
export type VoiceToolResult =
  | { readonly ok: true; readonly basis: string; readonly asOf: string; readonly data: unknown }
  | { readonly ok: false; readonly error: string }

/** The semantic layer's view of the same snapshot. */
export function toMetricContext(ctx: VoiceToolContext): MetricContext {
  return {
    orders: ctx.orders,
    products: ctx.products,
    settings: { lowStockThreshold: ctx.settings.lowStockThreshold },
    now: ctx.now,
  }
}
