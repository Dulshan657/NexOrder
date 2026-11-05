import type { Promotion, Order, Product, PromotionROI } from '../types';

export function getPromotionROI(
  promotions: readonly Promotion[],
  orders: readonly Order[],
  products: readonly Product[],
): PromotionROI[] {
  const countable = orders.filter(o => o.status !== 'cancelled');

  // Only orders recorded as using no promotion. An order with nothing recorded is from before
  // recording began, so it may have used one.
  const nonPromoOrders = countable.filter(o => o.appliedPromotions?.length === 0);
  const avgOrderValueWithout = nonPromoOrders.length > 0
    ? nonPromoOrders.reduce((sum, o) => sum + o.total, 0) / nonPromoOrders.length
    : 0;

  return promotions.map(promo => {
    // Find orders that used this promotion
    const promoOrders = countable.filter(o =>
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

    // Estimated uplift: how much higher is promo order AOV vs non-promo baseline. There is
    // nothing to compare without both, and a promotion nobody used is not 100% worse.
    const estimatedUplift = ordersUsing > 0 && avgOrderValueWithout > 0
      ? Math.round(((avgOrderValueWithPromo - avgOrderValueWithout) / avgOrderValueWithout) * 100 * 10) / 10
      : null;

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
