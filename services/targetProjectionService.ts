import type { SalesTarget, Order, TargetProjection, WeeklyPacePoint } from '../types';
import { computeTargetAchieved } from '../lib/semantic/targets';

const MS_PER_DAY = 86_400_000;

/**
 * What the target owner has achieved, delegated to the semantic layer.
 *
 * This function used to hold its own copy of the definition — the fourth in the
 * codebase — and it disagreed with the three in the dashboards on two points: it
 * bounded the window with `<= new Date(endDate)`, i.e. midnight, silently
 * dropping every order placed during the final day; and it defined a "new
 * HoReCa" as one with no order before the window rather than one whose first
 * order falls inside it. Both are now answered by `sales.newCustomerCount` and
 * friends, so the projection below is computed from the same number the
 * dashboards display.
 *
 * `userId` is honoured over `target.userId` because callers pass the viewing
 * user; the two are the same for every current call site.
 */
function getTargetValue(target: SalesTarget, orders: readonly Order[], userId: number): number {
  return computeTargetAchieved(
    { ...target, userId },
    { orders, products: [], settings: { lowStockThreshold: 0 }, now: new Date(target.endDate) },
  );
}

export function computeTargetProjection(
  target: SalesTarget,
  orders: readonly Order[],
  userId: number,
  now: Date = new Date(),
): TargetProjection {
  const start = new Date(target.startDate);
  const end = new Date(target.endDate);
  const currentValue = getTargetValue(target, orders, userId);

  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / MS_PER_DAY);
  const elapsedDays = Math.max(1, (now.getTime() - start.getTime()) / MS_PER_DAY);
  const daysRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / MS_PER_DAY));

  const dailyRate = currentValue / elapsedDays;
  const projectedFinal = currentValue + dailyRate * daysRemaining;
  const projectedPercent = target.targetValue > 0
    ? Math.round((projectedFinal / target.targetValue) * 100)
    : 0;

  let status: 'on_track' | 'behind' | 'at_risk';
  if (projectedPercent >= 90) status = 'on_track';
  else if (projectedPercent >= 60) status = 'behind';
  else status = 'at_risk';

  const formatValue = target.type === 'revenue'
    ? (v: number) => `$${Math.round(v).toLocaleString()}`
    : (v: number) => `${Math.round(v)}`;

  const message = `At current pace, you'll achieve ${formatValue(projectedFinal)} of ${formatValue(target.targetValue)} (${projectedPercent}%) by ${new Date(target.endDate).toLocaleDateString()}`;

  return {
    dailyRate: Math.round(dailyRate * 100) / 100,
    projectedFinal: Math.round(projectedFinal * 100) / 100,
    projectedPercent,
    status,
    daysRemaining,
    message,
  };
}

export function computeWeeklyPace(
  target: SalesTarget,
  orders: readonly Order[],
  userId: number,
  now: Date = new Date(),
): WeeklyPacePoint[] {
  const start = new Date(target.startDate);
  const end = new Date(target.endDate);
  const totalDays = (end.getTime() - start.getTime()) / MS_PER_DAY;
  const totalWeeks = Math.ceil(totalDays / 7);

  const points: WeeklyPacePoint[] = [];
  let cumulative = 0;

  for (let week = 0; week < totalWeeks; week++) {
    const weekStart = new Date(start.getTime() + week * 7 * MS_PER_DAY);
    const weekEnd = new Date(Math.min(weekStart.getTime() + 7 * MS_PER_DAY, end.getTime()));

    if (weekStart > now) {
      // Future week — project from current rate
      const elapsedDays = Math.max(1, (now.getTime() - start.getTime()) / MS_PER_DAY);
      const dailyRate = cumulative / elapsedDays;
      cumulative += dailyRate * 7;
    } else {
      // Past/current week — use actual data
      const weekOrders = orders.filter(o => {
        const d = new Date(o.orderDate);
        return o.submittedBy.id === userId && d >= weekStart && d < weekEnd;
      });

      switch (target.type) {
        case 'revenue':
          cumulative += weekOrders.reduce((sum, o) => sum + o.total, 0);
          break;
        case 'orders':
          cumulative += weekOrders.length;
          break;
        case 'new_horecas':
          // Deliberately NOT the canonical definition: this counts unique
          // customers active in the week, so a repeat customer contributes to the
          // pace line. The canonical acquisition count is `sales.newCustomerCount`
          // (see lib/semantic/targets.ts), which cannot be accumulated week by
          // week — a customer is new once, in one week, and summing per-week
          // "new" counts would double-count. Fixing the pace chart properly means
          // computing cumulative acquisitions from the range start each week,
          // which is a change to what the chart shows, not a refactor.
          cumulative += new Set(weekOrders.map(o => o.hoReCa.id)).size;
          break;
      }
    }

    const idealPace = target.targetValue * ((week + 1) / totalWeeks);

    points.push({
      weekStart: weekStart.toISOString().slice(0, 10),
      weekEnd: weekEnd.toISOString().slice(0, 10),
      cumulative: Math.round(cumulative * 100) / 100,
      idealPace: Math.round(idealPace * 100) / 100,
    });
  }

  return points;
}
