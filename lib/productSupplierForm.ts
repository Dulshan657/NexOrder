// Pure glue between ProductForm's supplier editor and the ProductSupplierLink[]
// the API expects (mig 00070). Kept out of the component so it's unit-testable —
// same shape as productUomForm.ts.
import type { Product, ProductSupplierLink } from '@/types';
import type { SupplierLinkDraft } from '@/components/admin/ProductSuppliersSection';
import { linksForProduct } from './productSuppliers';

/** Seed the editor from an existing product (or one blank row for a new one). */
export function supplierDraftsFromProduct(product: Product | null): SupplierLinkDraft[] {
    if (!product) return [newSupplierDraft()];
    const links = linksForProduct(product);
    if (links.length === 0) return [newSupplierDraft()];
    return links.map(l => ({
        supplierId: String(l.supplierId),
        supplierSku: l.supplierSku ?? '',
        costPrice: l.costPrice != null ? String(l.costPrice) : '',
        isPrimary: l.isPrimary,
    }));
}

export function newSupplierDraft(): SupplierLinkDraft {
    return { supplierId: '', supplierSku: '', costPrice: '', isPrimary: false };
}

export type AssembleSupplierLinksResult =
    | { ok: true; links: ProductSupplierLink[] }
    | { ok: false; error: string };

/**
 * Build the supplier list from the editor rows, enforcing the same cross-row
 * rules the server does (`validateProductSuppliers`) so the operator gets an
 * inline error before the round-trip: at least one supplier, no duplicates,
 * exactly one primary, non-negative costs.
 *
 * When no row is flagged primary the FIRST row is promoted rather than
 * rejected — `products.supplier_id` is NOT NULL, so something must always be
 * primary, and the server's RPC applies the same fallback.
 */
export function assembleSupplierLinks(drafts: SupplierLinkDraft[]): AssembleSupplierLinksResult {
    const rows = drafts.filter(d => d.supplierId.trim() !== '');
    if (rows.length === 0) return { ok: false, error: 'Please select at least one supplier.' };

    if (rows.filter(d => d.isPrimary).length > 1) {
        return { ok: false, error: 'Only one supplier can be the primary supplier.' };
    }
    const primaryIndex = rows.findIndex(d => d.isPrimary);
    const effectivePrimary = primaryIndex === -1 ? 0 : primaryIndex;

    const seen = new Set<number>();
    const links: ProductSupplierLink[] = [];

    for (let i = 0; i < rows.length; i++) {
        const draft = rows[i];
        const supplierId = parseInt(draft.supplierId, 10);
        if (isNaN(supplierId)) return { ok: false, error: 'Please select a supplier for every row.' };
        if (seen.has(supplierId)) {
            return { ok: false, error: 'The same supplier is listed twice.' };
        }
        seen.add(supplierId);

        // Cost is optional; a value that IS given must be usable.
        const rawCost = draft.costPrice.trim();
        let costPrice: number | undefined;
        if (rawCost) {
            const parsed = Number(rawCost);
            if (!Number.isFinite(parsed) || parsed < 0) {
                return { ok: false, error: 'A supplier cost price must be 0 or more.' };
            }
            costPrice = round2(parsed);
        }

        const supplierSku = draft.supplierSku.trim();
        links.push({
            supplierId,
            supplierSku: supplierSku === '' ? undefined : supplierSku,
            costPrice,
            isPrimary: i === effectivePrimary,
            sortOrder: i,
        });
    }

    return { ok: true, links };
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
