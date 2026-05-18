// Read-only stats for the admin dashboard tile.
//
// The pending_pos count + auto-approval ratio are computed off the
// pending_pos table directly. Cost / token / model-mix breakdown comes
// off po_extraction_audit, which is Admin-only via RLS. The Manager
// dashboard tile (Phase 2) would call a slimmer endpoint that omits
// cost data.
//
// Time windows are "today" (00:00 of the local server day) and the
// 7-day trailing average. We do the date math in SQL so timezone
// behavior matches whatever the Supabase project is configured for.

import { supabase } from '@/lib/supabase'

export interface PoInboxStats {
  windowStart: string                 // ISO of midnight today (server time)
  todayCount: number                  // pending_pos created today
  todayAutoApproved: number
  todayApproved: number
  todayRejected: number
  todayNeedsReview: number
  /** 0..1 — share of today's POs that were auto-approved. */
  autoApprovedRatio: number
  /** Total backlog regardless of date. */
  needsReviewBacklog: number
  /** USD cost from po_extraction_audit, today only. Null when no rows. */
  costUsdToday: number | null
  /** Rolling 7-day average cost. Null until we have a row in the window. */
  costUsdSevenDayAvg: number | null
}

const ZERO_STATS: PoInboxStats = {
  windowStart: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
  todayCount: 0,
  todayAutoApproved: 0,
  todayApproved: 0,
  todayRejected: 0,
  todayNeedsReview: 0,
  autoApprovedRatio: 0,
  needsReviewBacklog: 0,
  costUsdToday: null,
  costUsdSevenDayAvg: null,
}

export async function getPoInboxStats(): Promise<PoInboxStats> {
  const windowStart = new Date(new Date().setHours(0, 0, 0, 0))
  const windowStartIso = windowStart.toISOString()
  const sevenDaysAgo = new Date(windowStart.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // pending_pos breakdown for today + backlog count. One round-trip
  // each via count('exact', head=true) so we don't pull row data we
  // won't display.
  const [
    todayCountResult,
    todayAutoResult,
    todayApprovedResult,
    todayRejectedResult,
    todayNeedsReviewResult,
    backlogResult,
    costTodayResult,
    costSevenResult,
  ] = await Promise.all([
    supabase
      .from('pending_pos')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', windowStartIso),
    supabase
      .from('pending_pos')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', windowStartIso)
      .eq('status', 'auto_approved'),
    supabase
      .from('pending_pos')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', windowStartIso)
      .eq('status', 'approved'),
    supabase
      .from('pending_pos')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', windowStartIso)
      .eq('status', 'rejected'),
    supabase
      .from('pending_pos')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', windowStartIso)
      .eq('status', 'needs_review'),
    supabase
      .from('pending_pos')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'needs_review'),
    supabase
      .from('po_extraction_audit')
      .select('cost_usd')
      .gte('occurred_at', windowStartIso)
      .not('cost_usd', 'is', null),
    supabase
      .from('po_extraction_audit')
      .select('cost_usd, occurred_at')
      .gte('occurred_at', sevenDaysAgo)
      .not('cost_usd', 'is', null),
  ])

  // Distinguish silent RLS denial from a real failure.
  //
  // The pending_pos queries are gated by Admin/Manager SELECT only. If
  // ANY of them errored, it's a real problem (network blip, table
  // missing, etc.) — not RLS — because if it were RLS the caller
  // wouldn't have made it onto the admin dashboard at all. We surface
  // by throwing; TanStack Query's onError path then puts the tile in
  // an error state instead of silently zeroing.
  const pendingPoResults = [
    todayCountResult,
    todayAutoResult,
    todayApprovedResult,
    todayRejectedResult,
    todayNeedsReviewResult,
    backlogResult,
  ]
  const failed = pendingPoResults.find(r => r.error)
  if (failed) {
    throw new Error(`pending_pos stats query failed: ${failed.error?.message ?? 'unknown'}`)
  }

  const todayCount = todayCountResult.count ?? 0
  const todayAutoApproved = todayAutoResult.count ?? 0
  const todayApproved = todayApprovedResult.count ?? 0
  const todayRejected = todayRejectedResult.count ?? 0
  const todayNeedsReview = todayNeedsReviewResult.count ?? 0
  const needsReviewBacklog = backlogResult.count ?? 0

  // Cost reads can fail for Manager (po_extraction_audit is Admin-only
  // SELECT). That's expected, not an error — we just omit the cost.
  const costRowsToday = costTodayResult.error
    ? []
    : ((costTodayResult.data ?? []) as Array<{ cost_usd: number | null }>)
  const costRowsSeven = costSevenResult.error
    ? []
    : ((costSevenResult.data ?? []) as Array<{ cost_usd: number | null }>)

  const costUsdToday = sumCost(costRowsToday)
  // Round the FINAL avg, not the numerator — otherwise we'd carry up to
  // 7 decimal places of unrounded division through the API surface.
  const sevenDayTotal = sumCost(costRowsSeven)
  const costUsdSevenDayAvg = sevenDayTotal == null ? null : roundCost(sevenDayTotal / 7)

  return {
    windowStart: windowStartIso,
    todayCount,
    todayAutoApproved,
    todayApproved,
    todayRejected,
    todayNeedsReview,
    autoApprovedRatio: todayCount > 0 ? todayAutoApproved / todayCount : 0,
    needsReviewBacklog,
    costUsdToday,
    costUsdSevenDayAvg,
  }
}

function sumCost(rows: Array<{ cost_usd: number | null }>): number | null {
  if (rows.length === 0) return null
  let total = 0
  let hadAny = false
  for (const row of rows) {
    if (typeof row.cost_usd === 'number' && Number.isFinite(row.cost_usd)) {
      total += row.cost_usd
      hadAny = true
    }
  }
  return hadAny ? roundCost(total) : null
}

function roundCost(value: number): number {
  return Math.round(value * 10_000) / 10_000   // 4 decimal places
}
