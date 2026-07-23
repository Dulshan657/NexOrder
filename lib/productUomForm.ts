// Pure glue between ProductForm's inputs and the ProductUom[] the API expects
// (mig 00067). The base UOM is implied by the form's Unit + Price fields; the
// editor manages the higher packs. Kept out of the component so it's unit-testable.
import type { Product, ProductUom } from '@/types';
import type { ExtraUomDraft } from '@/components/admin/ProductUomsSection';
import { sortUoms } from './uom';

/** Seed the editor's non-base rows from an existing product's UOM list. */
export function extraUomsFromProduct(product: Product | null): ExtraUomDraft[] {
    if (!product?.uoms) return [];
    return sortUoms(product.uoms)
        .filter(u => !u.isBase)
        .map(u => ({
            code: u.code,
            factorToBase: String(u.factorToBase),
            price: String(u.price),
            isOrderable: u.isOrderable,
            isReceivable: u.isReceivable,
        }));
}

export type AssembleUomsResult =
    | { ok: true; uoms: ProductUom[] }
    | { ok: false; error: string };

/**
 * Build the full UOM list (base + extras) from the form fields and validate the
 * cross-row rules the server also enforces, so the operator gets an inline error
 * before the round-trip. Factors must be whole numbers ≥ 2 (the base is 1);
 * codes must be unique (case-insensitive) and non-empty; prices ≥ 0.
 */
export function assembleProductUoms(
    baseUnit: string,
    basePrice: number,
    extras: ExtraUomDraft[],
): AssembleUomsResult {
    const baseCode = (baseUnit || 'each').trim();
    const uoms: ProductUom[] = [{
        id: 0, productId: 0, code: baseCode, factorToBase: 1, isBase: true,
        price: round2(basePrice), isOrderable: true, isReceivable: true, sortOrder: 0,
    }];

    const seen = new Set<string>([baseCode.toLowerCase()]);
    for (let i = 0; i < extras.length; i++) {
        const draft = extras[i];
        const code = draft.code.trim();
        const factor = Number(draft.factorToBase);
        const price = Number(draft.price);

        if (!code) return { ok: false, error: 'Every unit needs a name.' };
        const key = code.toLowerCase();
        if (seen.has(key)) return { ok: false, error: `Duplicate unit name: "${code}".` };
        seen.add(key);

        if (!Number.isInteger(factor) || factor < 2) {
            return { ok: false, error: `"${code}" must contain a whole number of base units (2 or more).` };
        }
        if (!Number.isFinite(price) || price < 0) {
            return { ok: false, error: `"${code}" needs a price of 0 or more.` };
        }

        uoms.push({
            id: 0, productId: 0, code, factorToBase: factor, isBase: false,
            price: round2(price), isOrderable: draft.isOrderable, isReceivable: draft.isReceivable,
            sortOrder: i + 1,
        });
    }

    return { ok: true, uoms };
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
