import type { OrderItem, Promotion, HoReCa, User, Product, CartPromotionResult } from '../types';
import { isPromotionActive, isPromotionApplicable } from '../pricing';

/**
 * Apply cart-level promotions (BOGO and Bundle).
 * Unit-price promotions are handled in resolvePromotionPrice.
 */
export function applyCartPromotions(
    cartItems: OrderItem[],
    promotions: Promotion[],
    customer: HoReCa | null,
    currentUser: User | null,
    products: Product[],
): CartPromotionResult {
    const now = new Date();
    const activePromos = promotions.filter(p => isPromotionActive(p, now));

    const bogoFreeItems: CartPromotionResult['bogoFreeItems'] = [];
    const bundleDiscounts: CartPromotionResult['bundleDiscounts'] = [];

    // --- BOGO ---
    const bogoPromos = activePromos.filter(p => p.type === 'bogo' && p.bogoConfig);
    for (const promo of bogoPromos) {
        const config = promo.bogoConfig!;

        // Check targeting (use buy product for applicability check)
        const buyProduct = products.find(p => p.id === config.buyProductId);
        if (!buyProduct) continue;
        if (!isPromotionApplicable(promo, buyProduct, customer, currentUser)) continue;

        // Find buy items in cart
        const buyItems = cartItems.filter(item => item.id === config.buyProductId);
        const buyQty = buyItems.reduce((sum, item) => sum + item.quantity, 0);

        if (buyQty < config.buyQuantity) continue;

        // How many times the BOGO triggers
        const triggers = Math.floor(buyQty / config.buyQuantity);
        const freeQty = triggers * config.getQuantity;

        if (freeQty <= 0) continue;

        const getProduct = products.find(p => p.id === config.getProductId);
        const productName = getProduct?.name ?? `Product #${config.getProductId}`;

        // For same-product BOGO, the free items are "included" in existing qty
        // For cross-product, the free item may or may not be in cart
        bogoFreeItems.push({
            productId: config.getProductId,
            productName,
            freeQuantity: freeQty,
            promoId: promo.id,
            promoName: promo.name,
            triggerProductId: config.buyProductId,
            triggerQuantityRequired: config.buyQuantity,
            unit: promo.appliesTo ?? 'unit',
        });
    }

    // --- Bundles ---
    const bundlePromos = activePromos.filter(p => p.type === 'bundle' && p.bundleConfig);
    for (const promo of bundlePromos) {
        const config = promo.bundleConfig!;

        // Check targeting using first product in bundle
        const firstProduct = products.find(p => p.id === config.productIds[0]);
        if (!firstProduct) continue;
        if (!isPromotionApplicable(promo, firstProduct, customer, currentUser)) continue;

        // Check all bundle products are in cart
        const cartProductIds = new Set(cartItems.map(item => item.id));
        const allPresent = config.productIds.every(pid => cartProductIds.has(pid));
        if (!allPresent) continue;

        // Calculate how many complete bundles
        const bundleCounts = config.productIds.map(pid => {
            const items = cartItems.filter(item => item.id === pid);
            return items.reduce((sum, item) => sum + item.quantity, 0);
        });
        const completeBundles = Math.min(...bundleCounts);
        if (completeBundles <= 0) continue;

        // Sum of individual prices for bundle items
        const individualTotal = config.productIds.reduce((sum, pid) => {
            const item = cartItems.find(i => i.id === pid);
            return sum + (item ? item.price : 0);
        }, 0);

        const discountPerBundle = Math.max(individualTotal - config.bundlePrice, 0);
        const totalDiscount = Math.round(discountPerBundle * completeBundles * 100) / 100;

        if (totalDiscount > 0) {
            bundleDiscounts.push({
                promoId: promo.id,
                promoName: promo.name,
                discount: totalDiscount,
                productIds: config.productIds,
            });
        }
    }

    // BOGO free items are bonus deliverables at $0 — NOT a price discount on what was paid.
    // Only bundle promotions contribute to the cart total discount.
    const totalDiscount = Math.round(bundleDiscounts.reduce((s, b) => s + b.discount, 0) * 100) / 100;

    return { bogoFreeItems, bundleDiscounts, totalDiscount };
}
