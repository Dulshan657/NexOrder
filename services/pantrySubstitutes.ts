import type { Product } from '../types';
import type { PantryFrequencyMap } from '../hooks/usePantryFrequency';

const MAX_SUGGESTIONS = 3;

export interface SubstituteCandidate {
    product: Product;
    score: number;
}

export function getSubstitutes(
    target: Product,
    products: Product[],
    frequency: PantryFrequencyMap,
    excludeIds: ReadonlySet<number>,
): Product[] {
    const candidates: SubstituteCandidate[] = [];

    for (const product of products) {
        if (product.id === target.id) continue;
        if (excludeIds.has(product.id)) continue;
        if (product.category !== target.category) continue;
        if (product.inventory <= 0) continue;

        const freq = frequency[product.id];
        const count90d = freq?.count90d ?? 0;
        const count30d = freq?.count30d ?? 0;
        const score = count90d * 1 + count30d * 2;
        candidates.push({ product, score });
    }

    candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.product.name.localeCompare(b.product.name);
    });

    return candidates.slice(0, MAX_SUGGESTIONS).map(c => c.product);
}
