import type { Product, HoReCa, User, Promotion, OrderItem } from '../types';
import { UserRole } from '../types';

export const mkProduct = (overrides: Partial<Product> = {}): Product => ({
    id: 1,
    sku: 'SKU-1',
    name: 'Red Curry Paste',
    description: '',
    price: 4,
    category: 'Meal Pastes',
    inventory: 100,
    available: 100,
    unit: 'jar',
    cartonSize: 6,
    supplierId: 1,
    ...overrides,
});

export const mkHoReCa = (overrides: Partial<HoReCa> = {}): HoReCa => ({
    id: 10,
    name: 'Test Restaurant',
    address: '1 Test St',
    ...overrides,
});

export const mkUser = (overrides: Partial<User> = {}): User => ({
    id: 100,
    name: 'Rep One',
    email: 'rep@test.com',
    role: UserRole.FIELD_REP,
    ...overrides,
});

export const mkCartItem = (product: Product, quantity: number, packSize?: number): OrderItem => ({
    ...product,
    quantity,
    packSize,
});

const basePromo = {
    id: 'P-1',
    name: 'Test Promo',
    description: '',
    scope: { kind: 'storewide' as const },
    targeting: { kind: 'all' as const },
    stackWithHoReCaPricing: true,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 1,
    priority: 10,
};

export const mkBogoPromo = (overrides: Partial<Promotion> = {}): Promotion => ({
    ...basePromo,
    type: 'bogo',
    bogoConfig: { buyProductId: 1, buyQuantity: 2, getProductId: 1, getQuantity: 1 },
    ...overrides,
});

export const mkBundlePromo = (overrides: Partial<Promotion> = {}): Promotion => ({
    ...basePromo,
    type: 'bundle',
    bundleConfig: { productIds: [1, 2], bundlePrice: 7 },
    ...overrides,
});

export const mkPercentPromo = (overrides: Partial<Promotion> = {}): Promotion => ({
    ...basePromo,
    type: 'percentage',
    percentOff: 25,
    ...overrides,
});

export const mkFixedPricePromo = (overrides: Partial<Promotion> = {}): Promotion => ({
    ...basePromo,
    type: 'fixed_price',
    fixedPrice: 2,
    ...overrides,
});

export const mkClearancePromo = (overrides: Partial<Promotion> = {}): Promotion => ({
    ...basePromo,
    type: 'clearance',
    clearancePercent: 40,
    ...overrides,
});
