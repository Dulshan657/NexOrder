import { appDateKeysBetween } from './period'
import type { DateRevenue } from './semantic'

/**
 * Daily revenue for a window with the gaps filled by 0, on the Sydney date keys
 * `sales.revenueByDate` groups by — so no day is lost to a zone mismatch.
 * Shared by both dashboards (NX-0043); the Rep trend used UTC keys before.
 */
export function dailySeries(rows: readonly DateRevenue[], from: Date, to: Date): { date: string; revenue: number }[] {
  const byDate = new Map(rows.map(row => [row.date, row.revenue]))
  return appDateKeysBetween(from, to).map(date => ({ date, revenue: byDate.get(date) || 0 }))
}
