// get_follow_up_list: customers worth contacting now, most overdue first, each
// with the reason in a phrase that can be read out.

import type { Visit } from '@/types'
import type { VoiceToolContext } from '../context'
import { isRep, liveOrders, visibleVisits } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { dayOf, ok, plural } from './common'
import type { ToolOutcome } from './common'
import { managerCandidates, repCandidates } from './followUpCandidates'
import type { FollowUpCandidate } from './followUpCandidates'

interface FollowUpRow extends FollowUpCandidate {
  lastVisitDate: string | null
  reason: string
}

/** Latest visit day per customer. */
function lastVisitByCustomer(visits: readonly Visit[]): Map<number, string> {
  const latest = new Map<number, string>()
  for (const visit of visits) {
    if (Number.isNaN(new Date(visit.arrivalTime).getTime())) continue
    const known = latest.get(visit.hoReCaId)
    if (known === undefined || new Date(visit.arrivalTime).getTime() > new Date(known).getTime()) {
      latest.set(visit.hoReCaId, visit.arrivalTime)
    }
  }
  return latest
}

function reasonFor(c: FollowUpCandidate): string {
  const parts: string[] = []
  const until = c.daysUntilReorder
  if (until !== null && until < 0) parts.push(`usual reorder ${plural(-until, 'day')} overdue`)
  if (c.segment === 'at_risk') parts.push(`no order for ${plural(c.daysSinceLastOrder, 'day')}`)
  else if (c.segment === 'declining') parts.push('ordering less than they used to')
  if (until !== null && until >= 0) parts.push(until === 0 ? 'usual reorder due today' : `usual reorder due in ${plural(until, 'day')}`)
  return parts.join('; ')
}

const overdueDays = (c: FollowUpCandidate): number => (c.daysUntilReorder !== null && c.daysUntilReorder < 0 ? -c.daysUntilReorder : 0)

/** Most overdue first; then the longest quiet; then by name so the order is stable. */
function mostUrgentFirst(a: FollowUpCandidate, b: FollowUpCandidate): number {
  return overdueDays(b) - overdueDays(a) || b.daysSinceLastOrder - a.daysSinceLastOrder || a.name.localeCompare(b.name)
}

export function getFollowUpList(args: ToolArgs<'get_follow_up_list'>, ctx: VoiceToolContext): ToolOutcome {
  const orders = liveOrders(ctx)
  const rep = isRep(ctx)
  const candidates = rep
    ? repCandidates(orders, ctx.hoReCas, ctx.user.numericId, ctx.now)
    : managerCandidates(orders, ctx.hoReCas, ctx.now)

  const visited = lastVisitByCustomer(visibleVisits(ctx))
  const rows: FollowUpRow[] = candidates
    .sort(mostUrgentFirst)
    .map((c) => ({ ...c, lastVisitDate: dayOf(visited.get(c.horecaId)), reason: reasonFor(c) }))

  const today = dayOf(ctx.now.toISOString())
  const basis = rep
    ? `customers you have sold to who have gone quiet or are ordering less, from your own non-cancelled orders, as of ${today}`
    : `all customers whose usual reorder is overdue or due within 7 days, or who are at risk or declining, from non-cancelled orders, as of ${today}`
  return ok(basis, { customers: rows.slice(0, args.limit), total: rows.length })
}
