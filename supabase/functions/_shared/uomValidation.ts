// Cross-row validation for a product's UOM list (mig 00067). Deliberately free
// of Deno and zod imports so it can be unit-tested under vitest (same rationale
// as productBulk.ts). Field-level shape (types, min/max) is enforced by the zod
// schema in mutate-product; this covers the rules that span the whole list.

export interface UomInput {
  code: string;
  factor_to_base: number;
  is_base: boolean;
  price: number;
  is_orderable?: boolean;
  is_receivable?: boolean;
  sort_order?: number;
}

export type UomValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validate a product's UOM list:
 *  - non-empty
 *  - exactly one base UOM, and its factor_to_base is 1
 *  - codes unique within the product (case-insensitive)
 *  - every factor_to_base is a positive integer (fractional would truncate on
 *    the INT pack_size round-trip and silently mis-scale inventory — R1)
 *  - every price is a finite number >= 0
 */
export function validateUoms(uoms: readonly UomInput[]): UomValidationResult {
  if (!Array.isArray(uoms) || uoms.length === 0) {
    return { ok: false, error: 'A product needs at least one unit of measure.' };
  }

  const baseRows = uoms.filter(u => u.is_base);
  if (baseRows.length !== 1) {
    return { ok: false, error: 'Exactly one unit of measure must be the base unit.' };
  }
  if (baseRows[0].factor_to_base !== 1) {
    return { ok: false, error: 'The base unit of measure must have a factor of 1.' };
  }

  const seen = new Set<string>();
  for (const u of uoms) {
    const code = String(u.code ?? '').trim();
    if (code.length === 0) {
      return { ok: false, error: 'Every unit of measure needs a code.' };
    }
    const key = code.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `Duplicate unit-of-measure code: "${code}".` };
    }
    seen.add(key);

    if (!Number.isInteger(u.factor_to_base) || u.factor_to_base < 1) {
      return { ok: false, error: `Unit "${code}" must have a whole-number factor of 1 or more.` };
    }
    if (!Number.isFinite(u.price) || u.price < 0) {
      return { ok: false, error: `Unit "${code}" must have a price of 0 or more.` };
    }
  }

  return { ok: true };
}

/**
 * Server-side default UOM list, used when a create/bulk-create omits `uoms`
 * (e.g. a CSV import without UOM columns). Produces a base UOM at the unit price
 * and, when cartonSize > 1, a carton UOM at `price × cartonSize × (1 − discount%)`
 * — matching mig 00067's backfill so derived catalog stays consistent.
 */
export function deriveDefaultUomInputs(
  unit: string,
  price: number,
  cartonSize: number | null | undefined,
  cartonDiscountPercent = 0,
): UomInput[] {
  const baseCode = (unit && unit.trim()) || 'each';
  const base: UomInput = {
    code: baseCode,
    factor_to_base: 1,
    is_base: true,
    price: round2(price),
    is_orderable: true,
    is_receivable: true,
    sort_order: 0,
  };
  const size = Math.floor(Number(cartonSize ?? 1));
  if (size > 1) {
    const carton: UomInput = {
      // Avoid colliding with a base unit literally labelled 'carton'.
      code: baseCode.toLowerCase() === 'carton' ? 'case' : 'carton',
      factor_to_base: size,
      is_base: false,
      price: round2(price * size * (1 - cartonDiscountPercent / 100)),
      is_orderable: true,
      is_receivable: true,
      sort_order: 1,
    };
    return [base, carton];
  }
  return [base];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
