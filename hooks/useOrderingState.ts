import { useMemo } from 'react';
import type {
    HoReCa,
    Order,
    OrderItem,
    OrderingHint,
    Product,
    Promotion,
    User,
} from '../types';
import { resolveHoReCaPrice, getAllApplicablePromotions } from '../pricing';
import { getOrderingHints } from '../services/buyingPatternsService';
import type { SortOption } from '../components/ShopTopBar';

export interface OrderingStateInput {
    products: Product[];
    selectedHoReCa: HoReCa | undefined;
    currentUser: User;
    promotions: Promotion[];
    selectedCategory: string;
    searchQuery: string;
    sortOption: SortOption;
    allOrders: Order[];
    orderItems: OrderItem[];
}

export interface OrderingState {
    filteredProducts: Product[];
    orderingHints: OrderingHint[];
    hintsPerProduct: Map<number, OrderingHint[]>;
    missingItemHints: OrderingHint[];
    recentHoReCaProducts: Product[];
    lastOrderForHoReCa: Order | null;
}

export function useOrderingState(input: OrderingStateInput): OrderingState {
    const {
        products,
        selectedHoReCa,
        currentUser,
        promotions,
        selectedCategory,
        searchQuery,
        sortOption,
        allOrders,
        orderItems,
    } = input;

    const orderingHints = useMemo(() => {
        if (!selectedHoReCa) return [];
        const cartProductIds = orderItems.map(item => item.id);
        return getOrderingHints(allOrders, selectedHoReCa.id, cartProductIds);
    }, [allOrders, selectedHoReCa, orderItems]);

    const hintsPerProduct = useMemo(() => {
        const map = new Map<number, OrderingHint[]>();
        for (const hint of orderingHints) {
            if (hint.type === 'missing_from_usual') continue;
            const existing = map.get(hint.productId) ?? [];
            map.set(hint.productId, [...existing, hint]);
        }
        return map;
    }, [orderingHints]);

    const missingItemHints = useMemo(
        () => orderingHints.filter(h => h.type === 'missing_from_usual'),
        [orderingHints],
    );

    const filteredProducts = useMemo(() => {
        let categoryFiltered: Product[];
        if (selectedCategory === 'All') {
            categoryFiltered = products;
        } else if (selectedCategory === 'Deals') {
            categoryFiltered = products.filter(
                p => getAllApplicablePromotions(p, selectedHoReCa, currentUser, promotions).length > 0,
            );
        } else {
            categoryFiltered = products.filter(p => p.category === selectedCategory);
        }

        let result = categoryFiltered;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(
                p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
            );
        }

        if (sortOption === 'price-asc') {
            result = [...result].sort(
                (a, b) => resolveHoReCaPrice(a, selectedHoReCa) - resolveHoReCaPrice(b, selectedHoReCa),
            );
        } else if (sortOption === 'price-desc') {
            result = [...result].sort(
                (a, b) => resolveHoReCaPrice(b, selectedHoReCa) - resolveHoReCaPrice(a, selectedHoReCa),
            );
        } else if (sortOption === 'name-asc') {
            result = [...result].sort((a, b) => a.name.localeCompare(b.name));
        } else if (sortOption === 'name-desc') {
            result = [...result].sort((a, b) => b.name.localeCompare(a.name));
        } else if (sortOption === 'newest') {
            result = [...result].sort((a, b) => b.id - a.id);
        } else if (sortOption === 'popularity') {
            const freq = new Map<number, number>();
            for (const order of allOrders) {
                for (const item of order.items) {
                    freq.set(item.id, (freq.get(item.id) ?? 0) + item.quantity);
                }
            }
            result = [...result].sort((a, b) => (freq.get(b.id) ?? 0) - (freq.get(a.id) ?? 0));
        }

        // Pin featured products (demo/hero items, mig 00043) to the top of every
        // view. Array.sort is stable, so the chosen sortOption order is preserved
        // within the featured and non-featured groups.
        result = [...result].sort((a, b) => Number(!!b.featured) - Number(!!a.featured));

        return result;
    }, [products, selectedCategory, searchQuery, selectedHoReCa, currentUser, promotions, sortOption, allOrders]);

    const recentHoReCaProducts = useMemo(() => {
        if (!selectedHoReCa) return [];
        const hoReCaOrders = allOrders
            .filter(o => o.hoReCa.id === selectedHoReCa.id)
            .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
        const seen = new Set<number>();
        const result: Product[] = [];
        for (const order of hoReCaOrders) {
            for (const item of order.items) {
                if (!seen.has(item.id)) {
                    const product = products.find(p => p.id === item.id);
                    if (product) {
                        seen.add(item.id);
                        result.push(product);
                        if (result.length >= 3) return result;
                    }
                }
            }
        }
        return result;
    }, [allOrders, selectedHoReCa, products]);

    const lastOrderForHoReCa = useMemo(() => {
        const custId = selectedHoReCa?.id ?? null;
        if (!custId) return null;
        const hoReCaOrders = allOrders
            .filter(o => o.hoReCa.id === custId)
            .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
        return hoReCaOrders[0] ?? null;
    }, [allOrders, selectedHoReCa]);

    return {
        filteredProducts,
        orderingHints,
        hintsPerProduct,
        missingItemHints,
        recentHoReCaProducts,
        lastOrderForHoReCa,
    };
}
