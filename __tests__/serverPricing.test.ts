import { describe, it, expect } from 'vitest';
import {
    resolveUnitPrice,
    resolveLineUnitPrice,
    lineBaseUnits,
    type Product,
    type HoReCa,
    type Promotion,
    type UserContext,
} from '../supabase/functions/_shared/pricing';
import { cartonPrice as clientCartonPrice } from '../pricing';

// Server-typed fixtures (the _shared/pricing.ts copy has its own narrower interfaces).
const mkProduct = (o: Partial<Product> = {}): Product => ({
    id: 1,
    price: 10,
    category: 'Meal Pastes',
    inventory: 100,
    cartonSize: 12,
    ...o,
});

const user: UserContext = { id: 0, role: 'Field Sales Rep' };

const mkPercentPromo = (o: Partial<Promotion> = {}): Promotion => ({
    id: 'P-1',
    name: 'Percent',
    type: 'percentage',
    percentOff: 25,
    scope: { kind: 'storewide' },
    targeting: { kind: 'all' },
    stackWithHoReCaPricing: true,
    isActive: true,
    priority: 10,
    ...o,
});

const CARTON_DISCOUNT = 5; // percent

describe('resolveLineUnitPrice', () => {
    it('single-unit line (packSize null) equals the per-unit price', () => {
        const product = mkProduct();
        const perUnit = resolveUnitPrice(product, null, user, []).unitPrice;
        const line = resolveLineUnitPrice(product, null, user, [], null, CARTON_DISCOUNT).unitPrice;
        expect(line).toBe(perUnit);
        expect(line).toBe(10);
    });

    it('packSize of 1 is treated as a single unit (not a carton)', () => {
        const product = mkProduct();
        const line = resolveLineUnitPrice(product, null, user, [], 1, CARTON_DISCOUNT).unitPrice;
        expect(line).toBe(10);
    });

    it('carton line returns base × cartonSize × (1 − cartonDiscount)', () => {
        const product = mkProduct({ price: 10, cartonSize: 12 });
        // 10 × 12 × 0.95 = 114.00
        const line = resolveLineUnitPrice(product, null, user, [], 12, 5).unitPrice;
        expect(line).toBe(114);
    });

    it('carton line applies HoReCa per-product pricing to the per-unit base first', () => {
        const product = mkProduct({ id: 1, price: 10, cartonSize: 6 });
        const customer: HoReCa = { id: 10, pricing: { 1: 8 } };
        // perUnit = 8; carton = 8 × 6 × 0.95 = 45.60
        const line = resolveLineUnitPrice(product, customer, user, [], 6, 5).unitPrice;
        expect(line).toBeCloseTo(45.6, 2);
    });

    it('carton line applies a unit-level promotion to the per-unit base first', () => {
        const product = mkProduct({ id: 1, price: 10, cartonSize: 4 });
        const promo = mkPercentPromo({ percentOff: 25 }); // perUnit 10 → 7.50
        // 7.50 × 4 × 0.90 = 27.00
        const line = resolveLineUnitPrice(product, null, user, [promo], 4, 10).unitPrice;
        expect(line).toBe(27);
    });

    it('mirrors the client ProductCard formula for the same inputs', () => {
        const product = mkProduct({ price: 4, cartonSize: 6 });
        const cartonDiscountPercent = 5;
        const perUnit = resolveUnitPrice(product, null, user, []).unitPrice;
        const clientCartonPrice =
            Math.round(perUnit * product.cartonSize! * (1 - cartonDiscountPercent / 100) * 100) / 100;
        const line = resolveLineUnitPrice(product, null, user, [], product.cartonSize!, cartonDiscountPercent).unitPrice;
        expect(line).toBe(clientCartonPrice);
    });

    it('preserves the applied promotion id from the per-unit resolution', () => {
        const product = mkProduct({ id: 1, price: 10, cartonSize: 4 });
        const promo = mkPercentPromo({ id: 'PROMO-X', percentOff: 25 });
        const res = resolveLineUnitPrice(product, null, user, [promo], 4, 5);
        expect(res.appliedPromotionId).toBe('PROMO-X');
    });
});

describe('lineBaseUnits (canonical unit model)', () => {
    it('scales a carton line by its pack size', () => {
        expect(lineBaseUnits(5, 12)).toBe(60);
    });

    it('treats null/undefined pack size as a single-unit line', () => {
        expect(lineBaseUnits(7, null)).toBe(7);
        expect(lineBaseUnits(7, undefined)).toBe(7);
    });

    it('treats pack size of 1 as a single-unit line', () => {
        expect(lineBaseUnits(3, 1)).toBe(3);
    });
});

describe('client cartonPrice ↔ server resolveLineUnitPrice parity', () => {
    it('produces the same rounded carton price for shared inputs', () => {
        const product = mkProduct({ price: 4.5, cartonSize: 12 });
        const cartonDiscountPercent = 5;
        const server = resolveLineUnitPrice(
            product, null, user, [], product.cartonSize!, cartonDiscountPercent,
        ).unitPrice;
        const client = clientCartonPrice(product.price, product.cartonSize!, cartonDiscountPercent);
        expect(client).toBe(server);
        expect(client).toBe(51.3); // 4.5 × 12 × 0.95
    });

    it('rounds to cents identically (no client/server drift)', () => {
        const product = mkProduct({ price: 1.99, cartonSize: 12 });
        const server = resolveLineUnitPrice(product, null, user, [], 12, 5).unitPrice;
        const client = clientCartonPrice(1.99, 12, 5);
        expect(client).toBe(server);
        expect(client).toBe(22.69); // round(1.99 × 12 × 0.95) = round(22.6860)
    });
});
