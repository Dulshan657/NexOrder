// Small shared pieces for the tool files: the result constructors and the number
// and date shaping every tool does the same way, so "whole dollars" and "days
// since" mean one thing everywhere.

import type { ToolOutcome } from '../context'
import { isRep } from '../scope'
import { appDateKey } from '../period'
import type { VoiceToolContext } from '../context'

export type { ToolOutcome }

export const DAY_MS = 86_400_000

export function ok(basis: string, data: unknown): ToolOutcome {
  return { ok: true, basis, data }
}

export function fail(error: string): ToolOutcome {
  return { ok: false, error }
}

/** `-0` becomes `0`: it prints the same but is not equal to it, which bites in comparisons. */
export function clean(value: number): number {
  return value === 0 ? 0 : value
}

/** Money is spoken in whole dollars. */
export function dollars(value: number): number {
  return clean(Math.round(value))
}

/** A change in percent to one decimal place, or null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return clean(Math.round(((current - previous) / previous) * 1000) / 10)
}

/**
 * The Sydney calendar day of an ISO timestamp, `YYYY-MM-DD`, or null when there is
 * none. Sydney, not UTC: an order placed at 8 am on the 12th is "the 12th" to
 * everyone in the business, and to the dashboards (lib/period).
 */
export function dayOf(timestamp: string | null | undefined): string | null {
  return timestamp ? appDateKey(timestamp) : null
}

/** Whole days from an ISO timestamp to `now` (negative if it is in the future). */
export function daysSince(timestamp: string, now: Date): number {
  return clean(Math.round((now.getTime() - new Date(timestamp).getTime()) / DAY_MS))
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** "your own orders" for a rep, "all orders" for everyone else: the scope as spoken. */
export function ordersScope(ctx: VoiceToolContext): string {
  return isRep(ctx) ? 'your own orders' : 'all orders'
}
