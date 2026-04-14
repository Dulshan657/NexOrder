import type { Product, HoReCa, User, Promotion, PriceResolution, PromoBadgeType } from './types';

/**
 * Resolves the unit price for a product given a customer's pricing configuration.
 * Priority: whichever is LOWER between blanket discount price and per-product override.
 * Falls back to product.price if neither exists.
 */
export function resolveHoReCaPrice(product: Product, customer?: HoReCa | null): number {
    if (!customer) return product.price;

    const perProductPrice = customer?.pricing?.[product.id];
    const blanketPrice = customer.discountPercent != null && customer.discountPercent > 0
        ? product.price * (1 - customer.discountPercent / 100)
        : undefined;

    if (perProductPrice != null && blanketPrice != null) {
        return Math.min(perProductPrice, blanketPrice);
    }
    if (perProductPrice != null) return perProductPrice;
    if (blanketPrice != null) return blanketPrice;
    return product.price;
}

// --- Promotion Pricing ---

export function isPromotionActive(promo: Promotion, now: Date = new Date()): boolean {
    if (!promo.isActive) return false;
    const nowStr = now.toISOString().split('T')[0];
    if (promo.startDate && nowStr < promo.startDate) return false;
    if (promo.endDate && nowStr > promo.endDate) return false;
    return true;
}

export function isPromotionApplicable(
    promo: Promotion,
    product: Product,
    customer: HoReCa | null,
    currentUser: User | null,
): boolean {
    // Check scope
    const { scope } = promo;
    if (scope.kind === 'products' && !scope.productIds.includes(product.id)) return false;
    if (scope.kind === 'categories' && !scope.categories.includes(product.category)) return false;
    // 'storewide' always matches scope

    // Check targeting
    const { targeting } = promo;
    if (targeting.kind === 'hoReCas' && (!customer || !targeting.hoReCaIds.includes(customer.id))) return false;
    if (targeting.kind === 'tier' && (!customer?.tier || !targeting.tiers.includes(customer.tier))) return false;
    if (targeting.kind === 'rep' && (!currentUser || currentUser.id !== targeting.repUserId)) return false;
    // 'all' always matches targeting

    return true;
}

export function getApplicablePromotions(
    product: Product,
    customer: HoReCa | null,
    currentUser: User | null,
    promotions: Promotion[],
    now: Date = new Date(),
): Promotion[] {
    return promotions.filter(promo => {
        // BOGO and bundle are cart-level, not unit-price level
        if (promo.type === 'bogo' || promo.type === 'bundle') return false;
        return isPromotionActive(promo, now) && isPromotionApplicable(promo, product, customer, currentUser);
    });
}

/** Get all active promotions applicable to a product (including BOGO/bundle for badge display) */
export function getAllApplicablePromotions(
    product: Product,
    customer: HoReCa | null,
    currentUser: User | null,
    promotions: Promotion[],
    now: Date = new Date(),
): Promotion[] {
    return promotions.filter(promo =>
        isPromotionActive(promo, now) && isPromotionApplicable(promo, product, customer, currentUser)
    );
}

function calcPromoPrice(promo: Promotion, basePrice: number): number | null {
    switch (promo.type) {
        case 'percentage':
            return promo.percentOff != null ? basePrice * (1 - promo.percentOff / 100) : null;
        case 'fixed_price':
            return promo.fixedPrice ?? null;
        case 'clearance':
            return promo.clearancePercent != null ? basePrice * (1 - promo.clearancePercent / 100) : null;
        default:
            return null;
    }
}

function promoBadge(promo: Promotion): PromoBadgeType {
    switch (promo.type) {
        case 'clearance': return 'CLEARANCE';
        case 'bogo': return 'BOGO';
        case 'bundle': return 'BUNDLE';
        default: return 'SALE';
    }
}

export function resolvePromotionPrice(
    product: Product,
    customer: HoReCa | null,
    currentUser: User | null,
    promotions: Promotion[],
    now: Date = new Date(),
): PriceResolution {
    const originalPrice = product.price;
    const customerPrice = resolveHoReCaPrice(product, customer);
    const applicable = getApplicablePromotions(product, customer, currentUser, promotions, now);

    if (applicable.length === 0) {
        const savingsPercent = customerPrice < originalPrice
            ? Math.round((1 - customerPrice / originalPrice) * 100)
            : 0;
        return { finalPrice: customerPrice, originalPrice, customerPrice, appliedPromotion: null, badge: null, savingsPercent };
    }

    // Check for BOGO/bundle badges (even though they don't affect unit price)
    const allApplicable = getAllApplicablePromotions(product, customer, currentUser, promotions, now);
    const bogoOrBundle = allApplicable.find(p => p.type === 'bogo' || p.type === 'bundle');

    let bestPrice = customerPrice;
    let bestPromo: Promotion | null = null;

    for (const promo of applicable) {
        const base = promo.stackWithHoReCaPricing ? customerPrice : originalPrice;
        const promoPrice = calcPromoPrice(promo, base);
        if (promoPrice == null) continue;

        const rounded = Math.round(promoPrice * 100) / 100;
        if (rounded < bestPrice || (rounded === bestPrice && bestPromo && promo.priority < bestPromo.priority)) {
            bestPrice = rounded;
            bestPromo = promo;
        }
    }

    const finalPrice = Math.min(bestPrice, customerPrice);
    const appliedPromotion = finalPrice < customerPrice ? bestPromo : null;
    const badge = appliedPromotion ? promoBadge(appliedPromotion) : (bogoOrBundle ? promoBadge(bogoOrBundle) : null);
    const savingsPercent = finalPrice < originalPrice
        ? Math.round((1 - finalPrice / originalPrice) * 100)
        : 0;

    return { finalPrice, originalPrice, customerPrice, appliedPromotion, badge, savingsPercent };
}
