// get_visit_stats: a field rep's own routes and visits for a period.
//
// "Your own" is by the numeric id on the route (`createdBy`) and the visit
// (`userId`), both compared with ctx.user.numericId. Who may call this at all
// (Field Sales Reps, where the field_ops module is on) is toolsForRole's call.
//
// VISITS and ROUTE STOPS are different things and are kept apart in the output.
// A visit is one the rep logged; a stop is a planned place on a route. A rep who
// logs visits without planning a route used to be handed `completed: 0`, which
// Nex read out as "you completed 0 visits" to a rep with 28 logged (dev,
// 2026-10-29). With no stop planned there is now no stop count at all.

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
  const routePlanned = completion.planned > 0

  const stops = routePlanned
    ? 'route stops count as arrived when you checked in at them'
    : 'no route was planned, so there are no route stops to report'
  return ok(
    `your own logged visits ${period.label}; a visit converted when its outcome was an order placed; ${stops}`,
    {
      visitsLogged: conversion.totalVisits,
      visitsWithOrder: conversion.ordersPlaced,
      conversionRate: conversion.rate,
      ...(routePlanned
        ? { routeStops: { planned: completion.planned, arrived: completion.completed, skipped: completion.skipped, rate: completion.rate } }
        : {}),
    },
  )
}
