import type { Promotion, Order, Product, PromotionROI } from '../types';

export function getPromotionROI(
  promotions: readonly Promotion[],
  orders: readonly Order[],
  products: readonly Product[],
): PromotionROI[] {
  // Calculate overall average order value for non-promo orders as baseline
  const nonPromoOrders = orders.filter(o => !o.appliedPromotions || o.appliedPromotions.length === 0);
  const avgOrderValueWithout = nonPromoOrders.length > 0
    ? nonPromoOrders.reduce((sum, o) => sum + o.total, 0) / nonPromoOrders.length
    : 0;

  return promotions.map(promo => {
    // Find orders that used this promotion
    const promoOrders = orders.filter(o =>
      o.appliedPromotions?.some(ap => ap.promotionId === promo.id)
    );

    const ordersUsing = promoOrders.length;

    const totalDiscountGiven = promoOrders.reduce((sum, o) => {
      const applied = o.appliedPromotions?.find(ap => ap.promotionId === promo.id);
      return sum + (applied?.discount ?? 0);
    }, 0);

    const revenueFromPromoOrders = promoOrders.reduce((sum, o) => sum + o.total, 0);

    const avgOrderValueWithPromo = ordersUsing > 0
      ? revenueFromPromoOrders / ordersUsing
      : 0;

    // Estimated uplift: how much higher is promo order AOV vs non-promo baseline
    const estimatedUplift = avgOrderValueWithout > 0
      ? Math.round(((avgOrderValueWithPromo - avgOrderValueWithout) / avgOrderValueWithout) * 100 * 10) / 10
      : 0;

    return {
      promotionId: promo.id,
      promotionName: promo.name,
      type: promo.type,
      ordersUsing,
      totalDiscountGiven: Math.round(totalDiscountGiven * 100) / 100,
      revenueFromPromoOrders: Math.round(revenueFromPromoOrders * 100) / 100,
      avgOrderValueWithPromo: Math.round(avgOrderValueWithPromo * 100) / 100,
      avgOrderValueWithout: Math.round(avgOrderValueWithout * 100) / 100,
      estimatedUplift,
    };
  });
}
