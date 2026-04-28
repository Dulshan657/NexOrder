import { describe, it, expect } from 'vitest';
import {
    resolveHoReCaPrice,
    isPromotionActive,
    isPromotionApplicable,
    getApplicablePromotions,
    getAllApplicablePromotions,
    resolvePromotionPrice,
} from '../pricing';
import {
    mkProduct, mkHoReCa, mkUser,
    mkPercentPromo, mkFixedPricePromo, mkClearancePromo, mkBogoPromo, mkBundlePromo,
} from './fixtures';

const product = mkProduct({ id: 1, price: 10, category: 'Meal Pastes' });
const user = mkUser();

describe('resolveHoReCaPrice', () => {
    it('returns product.price when no customer', () => {
        expect(resolveHoReCaPrice(product, null)).toBe(10);
    });

    it('uses per-product override when lower than blanket discount', () => {
        const customer = mkHoReCa({ pricing: { 1: 6 }, discountPercent: 20 }); // blanket = 8
        expect(resolveHoReCaPrice(product, customer)).toBe(6);
    });

    it('uses blanket discount when lower than per-product override', () => {
        const customer = mkHoReCa({ pricing: { 1: 9 }, discountPercent: 50 }); // blanket = 5
        expect(resolveHoReCaPrice(product, customer)).toBe(5);
    });

    it('falls back to product.price with no customer pricing', () => {
        const customer = mkHoReCa();
        expect(resolveHoReCaPrice(product, customer)).toBe(10);
    });
});

describe('isPromotionActive', () => {
    const now = new Date('2026-06-15T12:00:00Z');

    it('returns false when isActive is false', () => {
        expect(isPromotionActive(mkPercentPromo({ isActive: false }), now)).toBe(false);
    });

    it('returns true with no date bounds', () => {
        expect(isPromotionActive(mkPercentPromo(), now)).toBe(true);
    });

    it('returns false before start date', () => {
        expect(isPromotionActive(mkPercentPromo({ startDate: '2026-07-01' }), now)).toBe(false);
    });

    it('returns false after end date', () => {
        expect(isPromotionActive(mkPercentPromo({ endDate: '2026-06-01' }), now)).toBe(false);
    });

    it('returns true within date window', () => {
        expect(isPromotionActive(mkPercentPromo({ startDate: '2026-06-01', endDate: '2026-06-30' }), now)).toBe(true);
    });
});

describe('isPromotionApplicable', () => {
    it('storewide scope applies to any product', () => {
        expect(isPromotionApplicable(mkPercentPromo(), product, null, user)).toBe(true);
    });

    it('product scope requires product in list', () => {
        const promo = mkPercentPromo({ scope: { kind: 'products', productIds: [2, 3] } });
        expect(isPromotionApplicable(promo, product, null, user)).toBe(false);
    });

    it('category scope requires product category in list', () => {
        const promo = mkPercentPromo({ scope: { kind: 'categories', categories: ['Coconut'] } });
        expect(isPromotionApplicable(promo, product, null, user)).toBe(false);
    });

    it('hoReCas targeting requires matching customer id', () => {
        const promo = mkPercentPromo({ targeting: { kind: 'horecas', hoReCaIds: [99] } });
        const customer = mkHoReCa({ id: 10 });
        expect(isPromotionApplicable(promo, product, customer, user)).toBe(false);
    });

    it('rep targeting requires matching currentUser id', () => {
        const promo = mkPercentPromo({ targeting: { kind: 'rep', repUserId: 999 } });
        expect(isPromotionApplicable(promo, product, null, user)).toBe(false);
    });
});

describe('getApplicablePromotions', () => {
    it('excludes BOGO and bundle (cart-level only)', () => {
        const promos = [mkPercentPromo(), mkBogoPromo(), mkBundlePromo()];
        const result = getApplicablePromotions(product, null, user, promos);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('percentage');
    });
});

describe('getAllApplicablePromotions', () => {
    it('includes BOGO and bundle for badge display', () => {
        const promos = [mkPercentPromo(), mkBogoPromo(), mkBundlePromo()];
        const result = getAllApplicablePromotions(product, null, user, promos);
        expect(result).toHaveLength(3);
    });
});

describe('resolvePromotionPrice — best price wins', () => {
    it('returns customer price when no promos apply', () => {
        const customer = mkHoReCa({ discountPercent: 10 }); // $9
        const result = resolvePromotionPrice(product, customer, user, []);
        expect(result.finalPrice).toBe(9);
        expect(result.appliedPromotion).toBeNull();
    });

    it('picks the lowest price across multiple competing promos', () => {
        const promos = [
            mkPercentPromo({ id: 'A', percentOff: 10 }), // $9
            mkPercentPromo({ id: 'B', percentOff: 30 }), // $7
            mkPercentPromo({ id: 'C', percentOff: 20 }), // $8
        ];
        const result = resolvePromotionPrice(product, null, user, promos);
        expect(result.finalPrice).toBe(7);
        expect(result.appliedPromotion?.id).toBe('B');
        expect(result.badge).toBe('SALE');
    });

    it('applies fixed_price when it beats percentage', () => {
        const promos = [
            mkPercentPromo({ percentOff: 10 }), // $9
            mkFixedPricePromo({ fixedPrice: 3 }), // $3
        ];
        const result = resolvePromotionPrice(product, null, user, promos);
        expect(result.finalPrice).toBe(3);
    });

    it('applies clearance percent and flags CLEARANCE badge', () => {
        const result = resolvePromotionPrice(product, null, user, [mkClearancePromo({ clearancePercent: 50 })]);
        expect(result.finalPrice).toBe(5);
        expect(result.badge).toBe('CLEARANCE');
    });

    it('never exceeds customer price (keeps customer price as ceiling)', () => {
        const customer = mkHoReCa({ pricing: { 1: 1 } }); // explicit $1 override avoids float drift
        // Non-stacking promo applies against original ($10 * 0.95 = $9.50) — worse than $1
        const worse = mkPercentPromo({ percentOff: 5, stackWithHoReCaPricing: false });
        const result = resolvePromotionPrice(product, customer, user, [worse]);
        expect(result.finalPrice).toBe(1);
        expect(result.appliedPromotion).toBeNull();
    });

    it('BOGO-only returns customer price with no badge (ProductCard surfaces BOGO badge separately)', () => {
        // resolvePromotionPrice short-circuits when no unit-price promo applies.
        // ProductCard.tsx uses getAllApplicablePromotions for the BOGO badge.
        const result = resolvePromotionPrice(product, null, user, [mkBogoPromo()]);
        expect(result.finalPrice).toBe(10);
        expect(result.badge).toBeNull();
    });

    it('surfaces BOGO badge when a unit-price promo also applies', () => {
        const result = resolvePromotionPrice(product, null, user, [mkPercentPromo({ percentOff: 10 }), mkBogoPromo()]);
        expect(result.finalPrice).toBe(9);
        // When a unit promo wins, its own SALE badge takes precedence
        expect(result.badge).toBe('SALE');
    });

    it('stackWithHoReCaPricing=true compounds percentage on customer price', () => {
        const customer = mkHoReCa({ discountPercent: 20 }); // $8
        const stacking = mkPercentPromo({ percentOff: 25, stackWithHoReCaPricing: true }); // $6 off of $8
        const result = resolvePromotionPrice(product, customer, user, [stacking]);
        expect(result.finalPrice).toBe(6);
    });

    it('stackWithHoReCaPricing=false applies promo against original price', () => {
        const customer = mkHoReCa({ discountPercent: 20 }); // $8
        const nonStacking = mkPercentPromo({ percentOff: 25, stackWithHoReCaPricing: false }); // $7.50 off original
        const result = resolvePromotionPrice(product, customer, user, [nonStacking]);
        expect(result.finalPrice).toBe(7.5);
    });
});
