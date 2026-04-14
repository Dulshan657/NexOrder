import { describe, it, expect } from 'vitest';
import { applyCartPromotions } from '../services/promotionService';
import {
    mkProduct, mkHoReCa, mkUser, mkCartItem,
    mkBogoPromo, mkBundlePromo,
} from './fixtures';

const redCurry = mkProduct({ id: 1, name: 'Red Curry Paste', price: 4 });
const greenCurry = mkProduct({ id: 2, name: 'Green Curry Paste', price: 4 });
const customer = mkHoReCa();
const user = mkUser();

describe('applyCartPromotions — BOGO same-product (Buy 2 Get 1 Free)', () => {
    const promo = mkBogoPromo();

    it('adds 1 free when qty is 2 — total unchanged', () => {
        const result = applyCartPromotions([mkCartItem(redCurry, 2)], [promo], customer, user, [redCurry]);
        expect(result.bogoFreeItems).toHaveLength(1);
        expect(result.bogoFreeItems[0].freeQuantity).toBe(1);
        expect(result.totalDiscount).toBe(0);
    });

    it('adds 2 free when qty is 4', () => {
        const result = applyCartPromotions([mkCartItem(redCurry, 4)], [promo], customer, user, [redCurry]);
        expect(result.bogoFreeItems[0].freeQuantity).toBe(2);
        expect(result.totalDiscount).toBe(0);
    });

    it('adds no free when qty is below threshold', () => {
        const result = applyCartPromotions([mkCartItem(redCurry, 1)], [promo], customer, user, [redCurry]);
        expect(result.bogoFreeItems).toHaveLength(0);
        expect(result.totalDiscount).toBe(0);
    });

    it('only one trigger when qty is 3 (buy 2 get 1, 1 leftover)', () => {
        const result = applyCartPromotions([mkCartItem(redCurry, 3)], [promo], customer, user, [redCurry]);
        expect(result.bogoFreeItems[0].freeQuantity).toBe(1);
    });

    it('aggregates qty across packSizes (unit + carton lines)', () => {
        const items = [
            mkCartItem(redCurry, 2),
            mkCartItem(redCurry, 2, 6),
        ];
        const result = applyCartPromotions(items, [promo], customer, user, [redCurry]);
        expect(result.bogoFreeItems[0].freeQuantity).toBe(2); // 4 buy qty / 2 = 2 triggers
    });

    it('returns trigger metadata for cart UI', () => {
        const result = applyCartPromotions([mkCartItem(redCurry, 2)], [promo], customer, user, [redCurry]);
        const free = result.bogoFreeItems[0];
        expect(free.triggerProductId).toBe(1);
        expect(free.triggerQuantityRequired).toBe(2);
        expect(free.unit).toBe('unit');
    });

    it('defaults appliesTo to "unit" when not set on promo', () => {
        const result = applyCartPromotions([mkCartItem(redCurry, 2)], [promo], customer, user, [redCurry]);
        expect(result.bogoFreeItems[0].unit).toBe('unit');
    });

    it('reports "carton" unit when promo.appliesTo is carton', () => {
        const cartonPromo = mkBogoPromo({ appliesTo: 'carton' });
        const result = applyCartPromotions([mkCartItem(redCurry, 2)], [cartonPromo], customer, user, [redCurry]);
        expect(result.bogoFreeItems[0].unit).toBe('carton');
    });
});

describe('applyCartPromotions — BOGO cross-product', () => {
    const promo = mkBogoPromo({
        bogoConfig: { buyProductId: 1, buyQuantity: 2, getProductId: 2, getQuantity: 1 },
    });

    it('adds free green curry when red curry qty meets threshold', () => {
        const result = applyCartPromotions([mkCartItem(redCurry, 2)], [promo], customer, user, [redCurry, greenCurry]);
        expect(result.bogoFreeItems).toHaveLength(1);
        expect(result.bogoFreeItems[0].productId).toBe(2);
        expect(result.bogoFreeItems[0].productName).toBe('Green Curry Paste');
        expect(result.totalDiscount).toBe(0);
    });
});

describe('applyCartPromotions — Bundle', () => {
    const bundle = mkBundlePromo(); // products [1,2] for $7 total

    it('applies discount equal to individual total minus bundle price', () => {
        const items = [mkCartItem(redCurry, 1), mkCartItem(greenCurry, 1)];
        const result = applyCartPromotions(items, [bundle], customer, user, [redCurry, greenCurry]);
        // individual total = 4 + 4 = 8; bundle price = 7; discount = 1 per bundle
        expect(result.bundleDiscounts).toHaveLength(1);
        expect(result.bundleDiscounts[0].discount).toBe(1);
        expect(result.totalDiscount).toBe(1);
    });

    it('multiplies discount by complete bundles', () => {
        const items = [mkCartItem(redCurry, 3), mkCartItem(greenCurry, 2)];
        const result = applyCartPromotions(items, [bundle], customer, user, [redCurry, greenCurry]);
        // 2 complete bundles (limited by green qty=2); discount = 1 * 2 = 2
        expect(result.bundleDiscounts[0].discount).toBe(2);
    });

    it('applies zero discount when not all bundle products are in cart', () => {
        const result = applyCartPromotions([mkCartItem(redCurry, 1)], [bundle], customer, user, [redCurry, greenCurry]);
        expect(result.bundleDiscounts).toHaveLength(0);
        expect(result.totalDiscount).toBe(0);
    });

    it('skips bundle when bundle price >= individual total (no negative discount)', () => {
        const noDiscount = mkBundlePromo({ bundleConfig: { productIds: [1, 2], bundlePrice: 10 } });
        const items = [mkCartItem(redCurry, 1), mkCartItem(greenCurry, 1)];
        const result = applyCartPromotions(items, [noDiscount], customer, user, [redCurry, greenCurry]);
        expect(result.bundleDiscounts).toHaveLength(0);
    });
});

describe('applyCartPromotions — targeting and activation', () => {
    it('ignores inactive promos', () => {
        const inactive = mkBogoPromo({ isActive: false });
        const result = applyCartPromotions([mkCartItem(redCurry, 2)], [inactive], customer, user, [redCurry]);
        expect(result.bogoFreeItems).toHaveLength(0);
    });

    it('ignores promos outside targeted tier', () => {
        const goldOnly = mkBogoPromo({ targeting: { kind: 'tier', tiers: ['Gold'] } });
        const bronzeHoReCa = mkHoReCa({ tier: 'Bronze' });
        const result = applyCartPromotions([mkCartItem(redCurry, 2)], [goldOnly], bronzeHoReCa, user, [redCurry]);
        expect(result.bogoFreeItems).toHaveLength(0);
    });

    it('applies promos within targeted tier', () => {
        const goldOnly = mkBogoPromo({ targeting: { kind: 'tier', tiers: ['Gold'] } });
        const goldHoReCa = mkHoReCa({ tier: 'Gold' });
        const result = applyCartPromotions([mkCartItem(redCurry, 2)], [goldOnly], goldHoReCa, user, [redCurry]);
        expect(result.bogoFreeItems).toHaveLength(1);
    });
});
