import type { Order, HoReCa, Category, HoReCaSegment, ProductFrequency, CoPurchasePair, OrderingHint, SpendingTrend, HoReCaInsights } from '../types';

// --- Helpers ---

const MS_PER_DAY = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / MS_PER_DAY;
}

function daysSince(date: string, now: Date = new Date()): number {
  return (now.getTime() - new Date(date).getTime()) / MS_PER_DAY;
}

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString();
}

function sortByDateAsc(orders: readonly Order[]): Order[] {
  return [...orders].sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());
}

function determineTrend(intervals: number[]): 'increasing' | 'decreasing' | 'stable' {
  if (intervals.length < 2) return 'stable';
  const mid = Math.floor(intervals.length / 2);
  const firstHalf = intervals.slice(0, mid);
  const secondHalf = intervals.slice(mid);
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  const ratio = avgSecond / avgFirst;
  if (ratio < 0.85) return 'increasing';  // shorter intervals = more frequent
  if (ratio > 1.15) return 'decreasing';
  return 'stable';
}

// --- Core Functions ---

export function getCustomerOrders(orders: readonly Order[], hoReCaId: number): Order[] {
  return sortByDateAsc(orders.filter(o => o.hoReCa.id === hoReCaId));
}

export function computeOrderFrequency(hoReCaOrders: readonly Order[]): {
  avgDaysBetween: number | null;
  predictedNextDate: string | null;
  trend: 'increasing' | 'decreasing' | 'stable';
} {
  const sorted = sortByDateAsc(hoReCaOrders);
  if (sorted.length < 2) return { avgDaysBetween: null, predictedNextDate: null, trend: 'stable' };

  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(daysBetween(sorted[i - 1].orderDate, sorted[i].orderDate));
  }

  const avgDaysBetween = Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length);
  const lastDate = sorted[sorted.length - 1].orderDate;
  const predictedNextDate = addDays(lastDate, avgDaysBetween);
  const trend = determineTrend(intervals);

  return { avgDaysBetween, predictedNextDate, trend };
}

export function computeProductFrequencies(hoReCaOrders: readonly Order[], now: Date = new Date()): ProductFrequency[] {
  const sorted = sortByDateAsc(hoReCaOrders);
  const productMap = new Map<number, {
    name: string;
    category: Category;
    orderDates: string[];
    quantities: number[];
  }>();

  for (const order of sorted) {
    for (const item of order.items) {
      const existing = productMap.get(item.id);
      if (existing) {
        existing.orderDates.push(order.orderDate);
        existing.quantities.push(item.quantity);
      } else {
        productMap.set(item.id, {
          name: item.name,
          category: item.category,
          orderDates: [order.orderDate],
          quantities: [item.quantity],
        });
      }
    }
  }

  const results: ProductFrequency[] = [];
  for (const [productId, data] of productMap) {
    const orderCount = data.orderDates.length;
    const totalQuantity = data.quantities.reduce((s, v) => s + v, 0);
    const avgQuantityPerOrder = Math.round((totalQuantity / orderCount) * 10) / 10;

    let avgDaysBetweenOrders: number | null = null;
    let predictedNextOrderDate: string | null = null;

    if (orderCount >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < data.orderDates.length; i++) {
        intervals.push(daysBetween(data.orderDates[i - 1], data.orderDates[i]));
      }
      avgDaysBetweenOrders = Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length);
      const lastDate = data.orderDates[data.orderDates.length - 1];
      predictedNextOrderDate = addDays(lastDate, avgDaysBetweenOrders);
    }

    const lastOrderedDate = data.orderDates[data.orderDates.length - 1];
    const isOverdue = predictedNextOrderDate !== null && new Date(predictedNextOrderDate).getTime() < now.getTime();

    results.push({
      productId,
      productName: data.name,
      category: data.category,
      orderCount,
      totalQuantity,
      avgQuantityPerOrder,
      avgDaysBetweenOrders,
      lastOrderedDate,
      predictedNextOrderDate,
      isOverdue,
    });
  }

  return results.sort((a, b) => b.orderCount - a.orderCount);
}

export function computeCoPurchasePatterns(orders: readonly Order[], minSupport: number = 2): CoPurchasePair[] {
  const pairCounts = new Map<string, { idA: number; nameA: string; idB: number; nameB: string; count: number }>();

  for (const order of orders) {
    const items = order.items;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const [a, b] = items[i].id < items[j].id ? [items[i], items[j]] : [items[j], items[i]];
        const key = `${a.id}-${b.id}`;
        const existing = pairCounts.get(key);
        if (existing) {
          pairCounts.set(key, { ...existing, count: existing.count + 1 });
        } else {
          pairCounts.set(key, { idA: a.id, nameA: a.name, idB: b.id, nameB: b.name, count: 1 });
        }
      }
    }
  }

  return Array.from(pairCounts.values())
    .filter(p => p.count >= minSupport)
    .map(p => ({
      productIdA: p.idA,
      productNameA: p.nameA,
      productIdB: p.idB,
      productNameB: p.nameB,
      coOccurrenceCount: p.count,
      supportPercent: Math.round((p.count / orders.length) * 1000) / 10,
    }))
    .sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount);
}

export function detectMissingFromUsualOrder(
  hoReCaOrders: readonly Order[],
  currentCartProductIds: number[],
  minFrequencyPercent: number = 50,
): OrderingHint[] {
  if (hoReCaOrders.length < 2) return [];

  const productCounts = new Map<number, { name: string; count: number; avgQty: number; totalQty: number }>();
  for (const order of hoReCaOrders) {
    for (const item of order.items) {
      const existing = productCounts.get(item.id);
      if (existing) {
        productCounts.set(item.id, { ...existing, count: existing.count + 1, totalQty: existing.totalQty + item.quantity });
      } else {
        productCounts.set(item.id, { name: item.name, count: 1, avgQty: item.quantity, totalQty: item.quantity });
      }
    }
  }

  const cartSet = new Set(currentCartProductIds);
  const hints: OrderingHint[] = [];

  for (const [productId, data] of productCounts) {
    const freqPercent = (data.count / hoReCaOrders.length) * 100;
    if (freqPercent >= minFrequencyPercent && !cartSet.has(productId)) {
      const avgQty = Math.round((data.totalQty / data.count) * 10) / 10;
      hints.push({
        type: 'missing_from_usual',
        productId,
        productName: data.name,
        message: `Usually orders ${avgQty} per order (in ${data.count} of ${hoReCaOrders.length} orders)`,
        value: avgQty,
        urgency: freqPercent >= 75 ? 'high' : 'medium',
      });
    }
  }

  return hints.sort((a, b) => (b.urgency === 'high' ? 1 : 0) - (a.urgency === 'high' ? 1 : 0));
}

export function segmentCustomer(
  hoReCaOrders: readonly Order[],
  allOrders: readonly Order[],
  now: Date = new Date(),
): HoReCaSegment {
  if (hoReCaOrders.length < 3) return 'new';

  const sorted = sortByDateAsc(hoReCaOrders);
  const lastOrderDate = sorted[sorted.length - 1].orderDate;
  const daysSinceLast = daysSince(lastOrderDate, now);

  if (daysSinceLast > 30) return 'at_risk';

  // Check high_value: top 20% by total spend
  const customerSpendMap = new Map<number, number>();
  for (const order of allOrders) {
    const current = customerSpendMap.get(order.hoReCa.id) ?? 0;
    customerSpendMap.set(order.hoReCa.id, current + order.total);
  }
  const allSpends = Array.from(customerSpendMap.values()).sort((a, b) => b - a);
  const top20Threshold = allSpends[Math.max(0, Math.floor(allSpends.length * 0.2) - 1)] ?? 0;
  const customerSpend = customerSpendMap.get(sorted[0].hoReCa.id) ?? 0;

  // Check trends
  const { trend: freqTrend } = computeOrderFrequency(hoReCaOrders);
  const spendTrend = computeSpendTrend(hoReCaOrders);

  if (freqTrend === 'increasing' || spendTrend === 'increasing') return 'growing';
  if (freqTrend === 'decreasing' || spendTrend === 'decreasing') return 'declining';
  if (customerSpend >= top20Threshold) return 'high_value';

  return 'high_value'; // default for active hoReCas with stable patterns
}

function computeSpendTrend(hoReCaOrders: readonly Order[]): 'increasing' | 'decreasing' | 'stable' {
  const sorted = sortByDateAsc(hoReCaOrders);
  if (sorted.length < 4) return 'stable';
  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);
  const avgFirst = firstHalf.reduce((s, o) => s + o.total, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, o) => s + o.total, 0) / secondHalf.length;
  const ratio = avgSecond / avgFirst;
  if (ratio > 1.15) return 'increasing';
  if (ratio < 0.85) return 'decreasing';
  return 'stable';
}

export function computeSpendingTrends(hoReCaOrders: readonly Order[]): SpendingTrend[] {
  const sorted = sortByDateAsc(hoReCaOrders);
  const monthMap = new Map<string, { orders: Order[] }>();

  for (const order of sorted) {
    const date = new Date(order.orderDate);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const existing = monthMap.get(month);
    if (existing) {
      existing.orders.push(order);
    } else {
      monthMap.set(month, { orders: [order] });
    }
  }

  const results: SpendingTrend[] = [];
  for (const [month, data] of monthMap) {
    const totalSpend = data.orders.reduce((s, o) => s + o.total, 0);
    const orderCount = data.orders.length;
    const avgOrderValue = Math.round((totalSpend / orderCount) * 100) / 100;
    const avgBasketSize = Math.round(
      (data.orders.reduce((s, o) => s + o.items.length, 0) / orderCount) * 10
    ) / 10;

    const categoryBreakdown: Record<string, number> = {};
    for (const order of data.orders) {
      for (const item of order.items) {
        categoryBreakdown[item.category] = (categoryBreakdown[item.category] ?? 0) + item.quantity * item.price;
      }
    }

    results.push({ month, totalSpend: Math.round(totalSpend * 100) / 100, orderCount, avgOrderValue, avgBasketSize, categoryBreakdown });
  }

  return results;
}

// --- Orchestrators ---

export function computeHoReCaInsights(
  orders: readonly Order[],
  hoReCaId: number,
  hoReCaName: string,
  now: Date = new Date(),
): HoReCaInsights {
  const hoReCaOrders = getCustomerOrders(orders, hoReCaId);
  const { avgDaysBetween, predictedNextDate, trend: frequencyTrend } = computeOrderFrequency(hoReCaOrders);
  const productFrequencies = computeProductFrequencies(hoReCaOrders, now);
  const spendingTrends = computeSpendingTrends(hoReCaOrders);
  const segment = segmentCustomer(hoReCaOrders, orders, now);
  const spendTrend = hoReCaOrders.length >= 4 ? computeSpendTrend(hoReCaOrders) : 'stable';
  const totalSpend = hoReCaOrders.reduce((s, o) => s + o.total, 0);
  const avgOrderValue = hoReCaOrders.length > 0 ? Math.round((totalSpend / hoReCaOrders.length) * 100) / 100 : 0;

  const sorted = sortByDateAsc(hoReCaOrders);
  const lastOrderDate = sorted.length > 0 ? sorted[sorted.length - 1].orderDate : null;
  const daysSinceLastOrder = lastOrderDate !== null ? Math.round(daysSince(lastOrderDate, now)) : null;

  return {
    hoReCaId,
    hoReCaName,
    segment,
    totalOrders: hoReCaOrders.length,
    totalSpend: Math.round(totalSpend * 100) / 100,
    avgDaysBetweenOrders: avgDaysBetween,
    predictedNextOrderDate: predictedNextDate,
    frequencyTrend,
    spendTrend,
    avgOrderValue,
    productFrequencies,
    spendingTrends,
    daysSinceLastOrder,
    lastOrderDate,
  };
}

export function computeAllHoReCaInsights(
  orders: readonly Order[],
  hoReCas: readonly HoReCa[],
  now: Date = new Date(),
): HoReCaInsights[] {
  return hoReCas.map(c => computeHoReCaInsights(orders, c.id, c.name, now));
}

export function getOrderingHints(
  orders: readonly Order[],
  hoReCaId: number,
  currentCartProductIds: number[],
  now: Date = new Date(),
): OrderingHint[] {
  const hoReCaOrders = getCustomerOrders(orders, hoReCaId);
  if (hoReCaOrders.length === 0) return [];

  const hints: OrderingHint[] = [];
  const frequencies = computeProductFrequencies(hoReCaOrders, now);

  for (const freq of frequencies) {
    // Typical quantity hint
    if (freq.orderCount >= 2) {
      hints.push({
        type: 'typical_quantity',
        productId: freq.productId,
        productName: freq.productName,
        message: `Usually orders ${freq.avgQuantityPerOrder}`,
        value: freq.avgQuantityPerOrder,
      });
    }

    // Reorder due hint
    if (freq.isOverdue && freq.predictedNextOrderDate) {
      const overdueDays = Math.round(daysSince(freq.predictedNextOrderDate, now));
      hints.push({
        type: 'reorder_due',
        productId: freq.productId,
        productName: freq.productName,
        message: `Due for reorder (${overdueDays} days overdue)`,
        urgency: overdueDays > 14 ? 'high' : overdueDays > 7 ? 'medium' : 'low',
      });
    }

    // Last ordered hint
    const daysAgo = Math.round(daysSince(freq.lastOrderedDate, now));
    if (daysAgo > 0) {
      hints.push({
        type: 'last_ordered',
        productId: freq.productId,
        productName: freq.productName,
        message: daysAgo === 1 ? 'Last ordered yesterday' : `Last ordered ${daysAgo} days ago`,
      });
    }
  }

  // Missing from usual order
  const missingHints = detectMissingFromUsualOrder(hoReCaOrders, currentCartProductIds);
  hints.push(...missingHints);

  return hints;
}

export function getReorderPredictions(
  orders: readonly Order[],
  hoReCas: readonly HoReCa[],
  now: Date = new Date(),
): Array<{ hoReCaId: number; hoReCaName: string; predictedDate: string; daysUntil: number; segment: HoReCaSegment }> {
  const predictions: Array<{ hoReCaId: number; hoReCaName: string; predictedDate: string; daysUntil: number; segment: HoReCaSegment }> = [];

  for (const customer of hoReCas) {
    const hoReCaOrders = getCustomerOrders(orders, customer.id);
    if (hoReCaOrders.length < 2) continue;

    const { predictedNextDate } = computeOrderFrequency(hoReCaOrders);
    if (!predictedNextDate) continue;

    const daysUntil = Math.round((new Date(predictedNextDate).getTime() - now.getTime()) / MS_PER_DAY);
    const segment = segmentCustomer(hoReCaOrders, orders, now);

    predictions.push({
      hoReCaId: customer.id,
      hoReCaName: customer.name,
      predictedDate: predictedNextDate,
      daysUntil,
      segment,
    });
  }

  return predictions.sort((a, b) => a.daysUntil - b.daysUntil);
}

export function getAtRiskCustomersForRep(
  orders: readonly Order[],
  hoReCas: readonly HoReCa[],
  userId: number,
  now: Date = new Date(),
): Array<{ hoReCaId: number; hoReCaName: string; segment: HoReCaSegment; daysSinceLastOrder: number }> {
  // Find customers this rep has served
  const repOrders = orders.filter(o => o.submittedBy.id === userId);
  const repCustomerIds = new Set(repOrders.map(o => o.hoReCa.id));

  const results: Array<{ hoReCaId: number; hoReCaName: string; segment: HoReCaSegment; daysSinceLastOrder: number }> = [];

  for (const customer of hoReCas) {
    if (!repCustomerIds.has(customer.id)) continue;

    const hoReCaOrders = getCustomerOrders(orders, customer.id);
    if (hoReCaOrders.length === 0) continue;

    const segment = segmentCustomer(hoReCaOrders, orders, now);
    if (segment !== 'at_risk' && segment !== 'declining') continue;

    const lastOrderDate = hoReCaOrders[hoReCaOrders.length - 1].orderDate;
    const dsl = Math.round(daysSince(lastOrderDate, now));

    results.push({
      hoReCaId: customer.id,
      hoReCaName: customer.name,
      segment,
      daysSinceLastOrder: dsl,
    });
  }

  return results.sort((a, b) => b.daysSinceLastOrder - a.daysSinceLastOrder);
}
