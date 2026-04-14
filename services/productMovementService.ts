import type { Order, Product, Category, ProductVelocity } from '../types';

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = MS_PER_DAY * 7;

function daysSince(date: string, now: Date = new Date()): number {
  return (now.getTime() - new Date(date).getTime()) / MS_PER_DAY;
}

interface ProductSalesData {
  productId: number;
  productName: string;
  category: Category;
  totalUnits: number;
  orderDates: string[];
  currentStock: number;
}

function aggregateSales(orders: readonly Order[], products: readonly Product[], periodDays: number = 90, now: Date = new Date()): ProductSalesData[] {
  const cutoff = new Date(now.getTime() - periodDays * MS_PER_DAY);
  const recentOrders = orders.filter(o => new Date(o.orderDate) >= cutoff);

  const salesMap = new Map<number, ProductSalesData>();

  // Initialize all products
  for (const product of products) {
    salesMap.set(product.id, {
      productId: product.id,
      productName: product.name,
      category: product.category,
      totalUnits: 0,
      orderDates: [],
      currentStock: product.inventory,
    });
  }

  for (const order of recentOrders) {
    for (const item of order.items) {
      const data = salesMap.get(item.id);
      if (data) {
        salesMap.set(item.id, {
          ...data,
          totalUnits: data.totalUnits + item.quantity,
          orderDates: [...data.orderDates, order.orderDate],
        });
      }
    }
  }

  return Array.from(salesMap.values());
}

export function computeSalesVelocity(
  orders: readonly Order[],
  products: readonly Product[],
  periodDays: number = 90,
  now: Date = new Date(),
): ProductVelocity[] {
  const salesData = aggregateSales(orders, products, periodDays, now);
  const weeks = periodDays / 7;

  // For trend: compare first half vs second half
  const midpoint = new Date(now.getTime() - (periodDays / 2) * MS_PER_DAY);

  return salesData.map(data => {
    const unitsPerWeek = Math.round((data.totalUnits / weeks) * 10) / 10;

    // Compute trend
    let trend: 'accelerating' | 'declining' | 'stable' = 'stable';
    if (data.orderDates.length >= 4) {
      const firstHalfUnits = orders
        .filter(o => new Date(o.orderDate) >= new Date(now.getTime() - periodDays * MS_PER_DAY) && new Date(o.orderDate) < midpoint)
        .reduce((sum, o) => sum + o.items.filter(i => i.id === data.productId).reduce((s, i) => s + i.quantity, 0), 0);
      const secondHalfUnits = orders
        .filter(o => new Date(o.orderDate) >= midpoint && new Date(o.orderDate) <= now)
        .reduce((sum, o) => sum + o.items.filter(i => i.id === data.productId).reduce((s, i) => s + i.quantity, 0), 0);

      if (firstHalfUnits > 0) {
        const ratio = secondHalfUnits / firstHalfUnits;
        if (ratio > 1.2) trend = 'accelerating';
        else if (ratio < 0.8) trend = 'declining';
      } else if (secondHalfUnits > 0) {
        trend = 'accelerating';
      }
    }

    const lastSoldDate = data.orderDates.length > 0
      ? data.orderDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
      : null;

    return {
      productId: data.productId,
      productName: data.productName,
      category: data.category,
      unitsPerWeek,
      trend,
      lastSoldDate,
      currentStock: data.currentStock,
    };
  });
}

export function getTopMovers(orders: readonly Order[], products: readonly Product[], limit: number = 10): ProductVelocity[] {
  return computeSalesVelocity(orders, products)
    .filter(v => v.unitsPerWeek > 0)
    .sort((a, b) => b.unitsPerWeek - a.unitsPerWeek)
    .slice(0, limit);
}

export function getSlowMovers(orders: readonly Order[], products: readonly Product[], limit: number = 10): ProductVelocity[] {
  return computeSalesVelocity(orders, products)
    .filter(v => v.unitsPerWeek > 0 && v.currentStock > 0)
    .sort((a, b) => a.unitsPerWeek - b.unitsPerWeek)
    .slice(0, limit);
}

export function getDeadStock(orders: readonly Order[], products: readonly Product[], thresholdDays: number = 30): ProductVelocity[] {
  const now = new Date();
  return computeSalesVelocity(orders, products)
    .filter(v => {
      if (v.currentStock <= 0) return false;
      if (v.lastSoldDate === null) return true;
      return daysSince(v.lastSoldDate, now) > thresholdDays;
    })
    .sort((a, b) => b.currentStock - a.currentStock);
}

export function getCategoryPerformance(orders: readonly Order[], products: readonly Product[]): Array<{ category: Category; totalUnits: number; totalRevenue: number; velocity: number }> {
  const velocities = computeSalesVelocity(orders, products);
  const categoryMap = new Map<Category, { units: number; revenue: number; velocity: number }>();

  for (const v of velocities) {
    const existing = categoryMap.get(v.category) ?? { units: 0, revenue: 0, velocity: 0 };
    // Get revenue from orders
    const productRevenue = orders.reduce((sum, o) =>
      sum + o.items.filter(i => i.id === v.productId).reduce((s, i) => s + i.quantity * i.price, 0), 0);
    categoryMap.set(v.category, {
      units: existing.units + Math.round(v.unitsPerWeek * 13), // ~90 days
      revenue: existing.revenue + productRevenue,
      velocity: existing.velocity + v.unitsPerWeek,
    });
  }

  return Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category,
      totalUnits: data.units,
      totalRevenue: Math.round(data.revenue * 100) / 100,
      velocity: Math.round(data.velocity * 10) / 10,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

export function getRestockAlerts(orders: readonly Order[], products: readonly Product[], leadTimeDays: number = 14): ProductVelocity[] {
  return computeSalesVelocity(orders, products)
    .filter(v => {
      if (v.unitsPerWeek <= 0 || v.currentStock <= 0) return false;
      const dailyRate = v.unitsPerWeek / 7;
      const daysOfStockRemaining = v.currentStock / dailyRate;
      return daysOfStockRemaining <= leadTimeDays;
    })
    .sort((a, b) => {
      const daysA = a.currentStock / (a.unitsPerWeek / 7);
      const daysB = b.currentStock / (b.unitsPerWeek / 7);
      return daysA - daysB;
    });
}

export function getDaysToStockout(orders: readonly Order[], products: readonly Product[]): Array<{
  productId: number;
  productName: string;
  currentStock: number;
  dailyRate: number;
  daysRemaining: number | null;
}> {
  const velocities = computeSalesVelocity(orders, products);
  return velocities
    .filter(v => v.currentStock > 0)
    .map(v => {
      const dailyRate = v.unitsPerWeek / 7;
      const daysRemaining = dailyRate > 0 ? Math.round(v.currentStock / dailyRate) : null;
      return {
        productId: v.productId,
        productName: v.productName,
        currentStock: v.currentStock,
        dailyRate: Math.round(dailyRate * 10) / 10,
        daysRemaining,
      };
    })
    .filter(d => d.daysRemaining !== null)
    .sort((a, b) => (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity));
}

export function computeMovementSummary(orders: readonly Order[], products: readonly Product[]): {
  totalUnitsSold: number;
  avgWeeklyVelocity: number;
  deadStockCount: number;
  restockAlertCount: number;
} {
  const velocities = computeSalesVelocity(orders, products);
  const activeProducts = velocities.filter(v => v.unitsPerWeek > 0);
  const totalUnitsSold = velocities.reduce((sum, v) => sum + Math.round(v.unitsPerWeek * 13), 0);
  const avgWeeklyVelocity = activeProducts.length > 0
    ? Math.round((activeProducts.reduce((sum, v) => sum + v.unitsPerWeek, 0) / activeProducts.length) * 10) / 10
    : 0;

  return {
    totalUnitsSold,
    avgWeeklyVelocity,
    deadStockCount: getDeadStock(orders, products).length,
    restockAlertCount: getRestockAlerts(orders, products).length,
  };
}
