// Option lists for the product form's unit-of-measure and category pickers.
//
// Both are "curated seed + what's actually in the catalog": the built-in list
// from constants.ts merged with every value already in use, so a name an
// operator invented once is offered to the next person instead of being retyped
// (and mistyped). Pure and IO-free — the callers pass the products they already
// have in cache, so no extra query is needed.
//
// Existing values are NEVER rewritten. The live catalog holds both 'each' and
// 'EA'; the merge offers the curated spelling for new picks but keeps 'EA' as
// its own entry, because renaming a UOM code deletes/recreates the row
// (set_product_uoms upserts on (product_id, code)) and would null
// order_items.uom_id on shipped orders.
import type { Product } from '../types';
import { CATEGORIES, UOM_CODES } from '../constants';

/**
 * Merge a curated list with values found in the wild.
 *
 * Curated entries come first in their authored order, then the extras sorted
 * alphabetically (case-insensitive). Dedupe is case-insensitive and the FIRST
 * spelling seen wins, so a curated 'carton' absorbs a stray 'Carton' while an
 * entirely off-list 'EA' survives verbatim.
 */
export function mergeOptions(
    curated: readonly string[],
    found: Iterable<string>,
): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of curated) {
        const key = value.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(value.trim());
    }

    const extras: string[] = [];
    for (const raw of found) {
        const value = (raw ?? '').trim();
        const key = value.toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        extras.push(value);
    }
    extras.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    return [...result, ...extras];
}

/** Unit-of-measure names to offer: UOM_CODES + every code used in the catalog. */
export function uomCodeOptions(products: readonly TaxonomySource[] | undefined): string[] {
    const found: string[] = [];
    for (const p of products ?? []) {
        if (p.unit) found.push(p.unit);
        for (const u of p.uoms ?? []) {
            if (u.code) found.push(u.code);
        }
    }
    return mergeOptions(UOM_CODES, found);
}

/**
 * The minimum a taxonomy helper reads. Structural on purpose: `useProducts`
 * hands back RAW DB rows while most other callers hold adapted `Product`
 * objects, and both satisfy this without a cast at either call site.
 */
export interface TaxonomySource {
    category?: string | null;
    brand?: string | null;
    unit?: string | null;
    uoms?: ReadonlyArray<{ code?: string | null }> | null;
}

/** Categories to offer: CATEGORIES + every category used in the catalog. */
export function categoryOptions(products: readonly TaxonomySource[] | undefined): string[] {
    const found: string[] = [];
    for (const p of products ?? []) {
        if (p.category) found.push(p.category);
    }
    return mergeOptions(CATEGORIES, found);
}

/**
 * Brands to offer: purely what the catalog already uses.
 *
 * NO CURATED LIST, deliberately. Categories ship with CATEGORIES because a food
 * distributor's are broadly predictable; brands are whatever this tenant sells,
 * and seeding them would put words in an operator's mouth on an empty catalogue.
 * Passing an empty curated list means autocomplete-from-existing falls straight
 * out of `mergeOptions` with no second code path.
 */
export function brandOptions(products: readonly TaxonomySource[] | undefined): string[] {
    const found: string[] = [];
    for (const p of products ?? []) {
        if (p.brand) found.push(p.brand);
    }
    return mergeOptions([], found);
}

/**
 * Guarantee the value being edited is present in its own dropdown, so opening a
 * product whose unit/category isn't in either source can't silently re-point the
 * field to whatever happens to be first. Case-insensitive: an exact-ish match
 * already in the list is left alone.
 */
export function withCurrentValue(options: readonly string[], value: string | undefined | null): string[] {
    const current = (value ?? '').trim();
    if (!current) return [...options];
    const has = options.some(o => o.toLowerCase() === current.toLowerCase());
    return has ? [...options] : [current, ...options];
}
