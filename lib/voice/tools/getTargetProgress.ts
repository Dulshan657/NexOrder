// get_target_progress: active sales targets, how far along each is, and whether
// the pace will get there.
//
// A target belongs to a rep by the NUMERIC `userId` on the row, compared with
// `ctx.user.numericId`. Never the uuid. (See the note in the task report: the
// adapter that builds SalesTarget currently yields 0 for that field, so in the
// running app these comparisons find nothing until the adapter is fixed.)

import { computeTargetProgress } from '@/lib/semantic'
import { computeTargetProjection } from '@/services/targetProjectionService'
import type { SalesTarget } from '@/types'
import type { VoiceToolContext } from '../context'
import { toMetricContext } from '../context'
import { formatRange } from '../period'
import { isRep } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { dayOf, ok } from './common'
import type { ToolOutcome } from './common'

const MAX_REPS = 10
const UNKNOWN_REP = 'Unknown rep'

interface TargetRow {
  type: string
  target: number
  achieved: number
  percent: number
  projectedFinal: number
  projectedPercent: number
  status: string
  daysRemaining: number
  endDate: string
}

function isActive(target: SalesTarget, today: string): boolean {
  return dayOf(target.startDate)! <= today && today <= dayOf(target.endDate)!
}

function describeTarget(target: SalesTarget, ctx: VoiceToolContext): TargetRow {
  const progress = computeTargetProgress(target, toMetricContext(ctx))
  const pace = computeTargetProjection(target, ctx.orders, target.userId, ctx.now)
  return {
    type: target.type,
    target: Math.round(target.targetValue),
    achieved: Math.round(progress.achieved),
    // Not progress.percent: that is capped at 100 for a progress bar, and a rep at
    // 140% of target should hear 140, beside a projection that is not capped either.
    percent: target.targetValue > 0 ? Math.round((progress.achieved / target.targetValue) * 100) : 0,
    projectedFinal: Math.round(pace.projectedFinal),
    projectedPercent: pace.projectedPercent,
    status: pace.status,
    daysRemaining: pace.daysRemaining,
    endDate: dayOf(target.endDate)!,
  }
}

function repName(userId: number, ctx: VoiceToolContext): string {
  if (userId === ctx.user.numericId) return ctx.user.name
  return ctx.orders.find((order) => order.submittedBy?.id === userId)?.submittedBy.name ?? UNKNOWN_REP
}

function groupByRep(targets: readonly SalesTarget[], ctx: VoiceToolContext) {
  const byRep = new Map<number, SalesTarget[]>()
  for (const target of targets) byRep.set(target.userId, [...(byRep.get(target.userId) ?? []), target])
  return [...byRep.entries()].map(([userId, owned]) => {
    const rows = owned.map((target) => describeTarget(target, ctx))
    return { name: repName(userId, ctx), targets: rows, worst: Math.min(...rows.map((r) => r.projectedPercent)) }
  })
}

export function getTargetProgress(_args: ToolArgs<'get_target_progress'>, ctx: VoiceToolContext): ToolOutcome {
  const today = ctx.now.toISOString().slice(0, 10)
  const running = ctx.salesTargets.filter((target) => isActive(target, today))
  const day = formatRange(ctx.now, ctx.now)
  const how = "achieved counts non-cancelled orders inside each target's dates; the projection carries the pace so far to the end date"

  if (isRep(ctx)) {
    const mine = running.filter((target) => target.userId === ctx.user.numericId)
    return ok(`your active sales targets on ${day}; ${how}`, { targets: mine.map((target) => describeTarget(target, ctx)) })
  }

  // Furthest behind first, so the cap of ten drops the reps who are doing best.
  const reps = groupByRep(running, ctx).sort((a, b) => a.worst - b.worst || a.name.localeCompare(b.name))
  const shown = reps.slice(0, MAX_REPS).map(({ name, targets }) => ({ name, targets }))
  return ok(`active sales targets on ${day} for up to ${MAX_REPS} reps, furthest behind first; ${how}`, {
    reps: shown,
    repCount: reps.length,
  })
}
