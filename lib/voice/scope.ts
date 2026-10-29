// Whose data a tool may use. One place, so no tool re-derives "a rep sees their
// own" for itself and gets it subtly different.
//
// A rep's orders are already limited by RLS to the ones they submitted, so for a
// real rep these filters change nothing. They exist so that the guarantee holds
// in this layer on its own: the tests hand a rep a cache that holds a colleague's
// orders too, and the answer must still be the rep's alone.
//
// Which tools a role may CALL is not decided here; that is toolsForRole, in the
// shared contract, applied by runVoiceTool.

import { REP_ROLES } from '@/supabase/functions/_shared/voice/toolSchemas'
import type { HoReCa, Order, Product, Visit } from '@/types'
import type { VoiceToolContext } from './context'

export function isRep(ctx: VoiceToolContext): boolean {
  return REP_ROLES.includes(ctx.user.role)
}

/** A rep's own orders (any status); everyone's for admins and managers. */
export function visibleOrders(ctx: VoiceToolContext): readonly Order[] {
  if (!isRep(ctx)) return ctx.orders
  return ctx.orders.filter((order) => order.submittedBy?.id === ctx.user.numericId)
}

/**
 * Visible orders that were not cancelled. A cancelled order was voided before
 * anything shipped, so it earned nothing, moved no stock and says nothing about
 * when a customer last bought; the semantic layer drops it by default for the
 * same reason, and so does every tool here.
 */
export function liveOrders(ctx: VoiceToolContext): readonly Order[] {
  return visibleOrders(ctx).filter((order) => order.status !== 'cancelled')
}

/** A rep's own visits; everyone's for admins and managers. */
export function visibleVisits(ctx: VoiceToolContext): readonly Visit[] {
  if (!isRep(ctx)) return ctx.visits
  return ctx.visits.filter((visit) => visit.userId === ctx.user.numericId)
}

/** Products an operator can act on. Retired ones are never reported. */
export function activeProducts(ctx: VoiceToolContext): readonly Product[] {
  return ctx.products.filter((product) => product.isActive !== false)
}

/**
 * The customers a rep may look up: those on their own orders. `undefined` means
 * no restriction, which is also what a rep with no orders yet gets; otherwise a
 * new rep could find nobody at all.
 */
export function allowedCustomerIds(ctx: VoiceToolContext): ReadonlySet<number> | undefined {
  if (!isRep(ctx)) return undefined
  const ids = new Set(visibleOrders(ctx).map((order) => order.hoReCa?.id).filter((id): id is number => id !== undefined))
  return ids.size > 0 ? ids : undefined
}

/**
 * A customer by id, if the caller knows of it. For a rep that means one they
 * could also have found by name, so an id lifted from elsewhere opens nothing.
 */
export function findVisibleCustomer(ctx: VoiceToolContext, id: number): HoReCa | undefined {
  // `undefined` here also means a rep with no orders yet, who is unrestricted. That
  // only lets them confirm a customer exists in ctx.hoReCas, which is data they were
  // already sent; every figure about it is still filtered to their own orders.
  const allowed = allowedCustomerIds(ctx)
  if (allowed && !allowed.has(id)) return undefined
  return ctx.hoReCas.find((customer) => customer.id === id)
}
