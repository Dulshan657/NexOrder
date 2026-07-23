// Pure helpers for N-level units of measure (mig 00067). No IO — safe to import
// from both the Vite frontend and vitest. All functions are immutable: they
// return new arrays/objects and never mutate their inputs.
import type { ProductUom } from '../types';

/** The base UOM (factorToBase 1) for a product, or undefined if the list is empty. */
export function baseUom(uoms: readonly ProductUom[] | undefined): ProductUom | undefined {
  if (!uoms) return undefined;
  return uoms.find(u => u.isBase);
}

/** A new array sorted by sortOrder ascending, then by factorToBase as a tiebreak. */
export function sortUoms(uoms: readonly ProductUom[] | undefined): ProductUom[] {
  if (!uoms) return [];
  return [...uoms].sort((a, b) => a.sortOrder - b.sortOrder || a.factorToBase - b.factorToBase);
}

/** Sorted UOMs a customer may order in. */
export function orderableUoms(uoms: readonly ProductUom[] | undefined): ProductUom[] {
  return sortUoms(uoms).filter(u => u.isOrderable);
}

/** Sorted UOMs stock may be received in. */
export function receivableUoms(uoms: readonly ProductUom[] | undefined): ProductUom[] {
  return sortUoms(uoms).filter(u => u.isReceivable);
}

/** Look up a UOM by its id. */
export function findUomById(
  uoms: readonly ProductUom[] | undefined,
  id: number | null | undefined,
): ProductUom | undefined {
  if (!uoms || id == null) return undefined;
  return uoms.find(u => u.id === id);
}

/**
 * Legacy fallback: find a UOM by its factor when only a packSize is known (e.g.
 * a pantry/order line persisted before uom_id existed). Prefers the base UOM
 * for factor 1. Returns undefined if no UOM matches.
 */
export function findUomByFactor(
  uoms: readonly ProductUom[] | undefined,
  factor: number | null | undefined,
): ProductUom | undefined {
  if (!uoms) return undefined;
  const f = factor ?? 1;
  if (f === 1) return baseUom(uoms) ?? uoms.find(u => u.factorToBase === 1);
  return uoms.find(u => u.factorToBase === f);
}

/**
 * Synthesize the default UOM list for a product from its legacy fields, used to
 * seed new products and as a UI fallback when `product.uoms` is empty (pre-
 * migration read). Produces a base UOM (factor 1, priced at the unit price) and,
 * when cartonSize > 1, a carton UOM priced with the historical derived formula
 * `price × cartonSize × (1 − cartonDiscount%)` so nothing changes for existing
 * catalog. Ids are 0 (unpersisted) — callers must not rely on them.
 */
export function deriveDefaultUoms(
  unit: string,
  price: number,
  cartonSize: number | null | undefined,
  cartonDiscountPercent = 0,
): ProductUom[] {
  const base: ProductUom = {
    id: 0,
    productId: 0,
    code: unit || 'each',
    factorToBase: 1,
    isBase: true,
    price: round2(price),
    isOrderable: true,
    isReceivable: true,
    sortOrder: 0,
  };
  const size = Math.floor(Number(cartonSize ?? 1));
  if (size > 1) {
    const carton: ProductUom = {
      id: 0,
      productId: 0,
      code: 'carton',
      factorToBase: size,
      isBase: false,
      price: round2(price * size * (1 - cartonDiscountPercent / 100)),
      isOrderable: true,
      isReceivable: true,
      sortOrder: 1,
    };
    return [base, carton];
  }
  return [base];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
