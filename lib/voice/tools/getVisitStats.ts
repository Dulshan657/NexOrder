// get_visit_stats: a field rep's own routes and visits for a period.
//
// "Your own" is by the numeric id on the route (`createdBy`) and the visit
// (`userId`), both compared with ctx.user.numericId. Who may call this at all
// (Field Sales Reps, where the field_ops module is on) is toolsForRole's call.

import { getVisitCompletionRate, getVisitConversionRate } from '@/services/repProductivityService'
import type { VoiceToolContext } from '../context'
import { resolvePeriod } from '../period'
import { visibleOrders } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { ok } from './common'
import type { ToolOutcome } from './common'

export function getVisitStats(args: ToolArgs<'get_visit_stats'>, ctx: VoiceToolContext): ToolOutcome {
  const period = resolvePeriod(args.period, ctx.now)
  const me = ctx.user.numericId
  const completion = getVisitCompletionRate(ctx.visits, ctx.routes, me, period.from, period.to)
  const conversion = getVisitConversionRate(ctx.visits, visibleOrders(ctx), me, period.from, period.to)

  return ok(
    `your own routes and visits ${period.label}; a stop is completed when you arrived at it, ` +
      'and a visit converted when its outcome was an order placed',
    {
      planned: completion.planned,
      completed: completion.completed,
      skipped: completion.skipped,
      completionRate: completion.rate,
      visits: conversion.totalVisits,
      ordersPlaced: conversion.ordersPlaced,
      conversionRate: conversion.rate,
    },
  )
}
