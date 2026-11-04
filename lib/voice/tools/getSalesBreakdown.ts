// get_sales_breakdown: a period's sales split by customer, product, category or
// rep, and, against the previous period, what DROVE the change (NX-0014).
//
// "Which customers drove the drop?" was answered "I can't say exactly" (dev,
// 2026-10-29): the sales summary only knew the top five of each period. Here
// every row of both periods is compared, and the change is decomposed:
//   - drivers: the rows that moved in the SAME direction as the total, largest
//     first, each with its share of the total change. A share can pass 100% when
//     other rows moved the other way; that is the honest figure, and those rows
//     are returned as `offsets`;
//   - offsets: the rows that moved against it.
//
// The value is the registry's: customers and reps at the stored order total
// (what was invoiced), categories and products at line value (price x quantity),
// because a stored total belongs to the whole order and not to one category or
// product. The basis says which. A rep sees only their own orders, and may not
// rank reps.

import { evaluateMetric } from '@/lib/semantic'
import type { CategoryRevenue, CustomerRevenue, MetricContext, OrderFilter, RepRevenue } from '@/lib/semantic'
import type { VoiceToolContext } from '../context'
import { toMetricContext } from '../context'
import { formatRange, resolvePeriod } from '../period'
import { activeProducts, isRep } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { dollars, fail, ok, ordersScope, percentChange } from './common'
import type { ToolOutcome } from './common'

const MAX_DRIVERS = 5
const MAX_OFFSETS = 3

interface Cell {
  key: string
  name: string
  value: number
}

type By = ToolArgs<'get_sales_breakdown'>['by']

function cellsFor(by: By, ctx: VoiceToolContext, mctx: MetricContext, filter: OrderFilter): Cell[] {
  switch (by) {
    case 'customer':
      return evaluateMetric<CustomerRevenue[]>('sales.revenueByCustomer', mctx, filter).map((r) => ({ key: String(r.horecaId), name: r.name, value: r.revenue }))
    case 'rep':
      return evaluateMetric<RepRevenue[]>('sales.revenueByRep', mctx, filter).map((r) => ({ key: String(r.repId), name: r.name, value: r.revenue }))
    case 'category':
      return evaluateMetric<CategoryRevenue[]>('sales.revenueByCategory', mctx, filter).map((r) => ({ key: r.category, name: r.category, value: r.revenue }))
    case 'product':
      // One line-scoped evaluation per product that sold: line value, never an order total.
      return activeProducts(ctx)
        .map((p) => ({ key: String(p.id), name: p.name, value: evaluateMetric<number>('sales.lineRevenue', mctx, { ...filter, productId: p.id }) }))
        .filter((c) => c.value !== 0)
        .sort((a, b) => b.value - a.value)
    default:
      throw new RangeError(`Unknown breakdown: ${String(by)}`)
  }
}

const MEASURE: Readonly<Record<By, string>> = {
  customer: 'order total',
  rep: 'order total',
  category: 'line value',
  product: 'line value',
}

function sum(cells: readonly Cell[]): number {
  return cells.reduce((total, c) => total + c.value, 0)
}

function compared(current: readonly Cell[], previous: readonly Cell[], limit: number) {
  const before = new Map(previous.map((c) => [c.key, c]))
  const keys = [...new Set([...current.map((c) => c.key), ...previous.map((c) => c.key)])]
  const merged = keys.map((key) => {
    const now = current.find((c) => c.key === key)
    const was = before.get(key)
    const value = now?.value ?? 0
    const prior = was?.value ?? 0
    return { key, name: now?.name ?? was?.name ?? key, value, prior, change: value - prior }
  })
  const totalChange = sum(current) - sum(previous)
  const direction = Math.sign(totalChange)
  const share = (change: number) => (totalChange === 0 ? null : Math.round((change / totalChange) * 100))
  const asDriver = (m: (typeof merged)[number]) => ({ key: m.key, name: m.name, change: dollars(m.change), sharePercent: share(m.change) })
  const bySize = (a: (typeof merged)[number], b: (typeof merged)[number]) => Math.abs(b.change) - Math.abs(a.change)
  return {
    rows: merged
      .sort((a, b) => b.value - a.value || b.prior - a.prior)
      .slice(0, limit)
      .map((m) => ({ key: m.key, name: m.name, value: dollars(m.value), previous: dollars(m.prior), change: dollars(m.change) })),
    drivers: direction === 0 ? [] : merged.filter((m) => Math.sign(m.change) === direction).sort(bySize).slice(0, MAX_DRIVERS).map(asDriver),
    offsets: direction === 0 ? [] : merged.filter((m) => Math.sign(m.change) === -direction).sort(bySize).slice(0, MAX_OFFSETS).map(asDriver),
    totalChange,
  }
}

export function getSalesBreakdown(args: ToolArgs<'get_sales_breakdown'>, ctx: VoiceToolContext): ToolOutcome {
  if (args.by === 'rep' && isRep(ctx)) return fail('Rep rankings are for managers and admins')

  const period = resolvePeriod(args.period, ctx.now, { from: args.from, to: args.to })
  const mctx = toMetricContext(ctx)
  const scope: OrderFilter = isRep(ctx) ? { repId: ctx.user.numericId } : {}
  const current = cellsFor(args.by, ctx, mctx, { ...scope, from: period.from, to: period.to })
  const measure = MEASURE[args.by]
  const repNote = args.by === 'rep' ? '; only orders placed by sales reps count as rep sales' : ''
  const basis = `${period.label}: ${ordersScope(ctx)} by ${args.by}, valued at ${measure}, cancelled excluded${repNote}`

  if (!args.compare_previous) {
    return ok(basis, {
      by: args.by,
      measure,
      total: dollars(sum(current)),
      rows: current.slice(0, args.limit).map((c) => ({ key: c.key, name: c.name, value: dollars(c.value) })),
    })
  }

  const previous = cellsFor(args.by, ctx, mctx, { ...scope, from: period.previous.from, to: period.previous.to })
  const result = compared(current, previous, args.limit)
  return ok(`${basis}; compared with ${formatRange(period.previous.from, period.previous.to)}`, {
    by: args.by,
    measure,
    total: dollars(sum(current)),
    previousTotal: dollars(sum(previous)),
    previousLabel: formatRange(period.previous.from, period.previous.to),
    change: dollars(result.totalChange),
    changePercent: percentChange(sum(current), sum(previous)),
    rows: result.rows,
    drivers: result.drivers,
    offsets: result.offsets,
  })
}
