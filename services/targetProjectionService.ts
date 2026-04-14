import type { SalesTarget, Order, TargetProjection, WeeklyPacePoint } from '../types';

const MS_PER_DAY = 86_400_000;

function getTargetValue(target: SalesTarget, orders: readonly Order[], userId: number): number {
  const start = new Date(target.startDate);
  const end = new Date(target.endDate);
  const filtered = orders.filter(o => {
    const d = new Date(o.orderDate);
    return o.submittedBy.id === userId && d >= start && d <= end;
  });

  switch (target.type) {
    case 'revenue':
      return filtered.reduce((sum, o) => sum + o.total, 0);
    case 'orders':
      return filtered.length;
    case 'new_horecas': {
      const allPriorCustomerIds = new Set(
        orders
          .filter(o => o.submittedBy.id === userId && new Date(o.orderDate) < start)
          .map(o => o.hoReCa.id)
      );
      const newCustomerIds = new Set(
        filtered.map(o => o.hoReCa.id).filter(id => !allPriorCustomerIds.has(id))
      );
      return newCustomerIds.size;
    }
    default:
      return 0;
  }
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
          // Simplified: count unique customer IDs in this week's orders
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
