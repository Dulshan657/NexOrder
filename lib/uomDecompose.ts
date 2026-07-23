// Pure decomposition of a base-unit quantity into a human-readable UOM breakdown
// (mig 00067). Inventory is always stored in base units; this is display-only.
import type { ProductUom } from '../types';
import { sortUoms } from './uom';

export interface UomBreakdown {
  code: string;
  count: number;
  factorToBase: number;
}

/**
 * Greedily decompose `baseQty` base units into the largest UOMs first, e.g.
 * 500 base units with each(1)/carton(12)/pallet(480) → 1 pallet + 1 carton + 8 each.
 * Only whole counts are emitted; any remainder falls through to the base UOM (or,
 * if there is no factor-1 UOM, to a synthetic 'each'). UOMs with count 0 are omitted.
 * Non-positive quantities yield an empty array.
 */
export function decomposeToUoms(
  baseQty: number,
  uoms: readonly ProductUom[] | undefined,
): UomBreakdown[] {
  const qty = Math.floor(Number(baseQty) || 0);
  if (qty <= 0) return [];

  // Largest factor first. Ignore factor < 1 or non-finite (defensive).
  const tiers = sortUoms(uoms)
    .filter(u => Number.isFinite(u.factorToBase) && u.factorToBase >= 1)
    .sort((a, b) => b.factorToBase - a.factorToBase);

  const out: UomBreakdown[] = [];
  let remaining = qty;
  for (const tier of tiers) {
    const factor = Math.floor(tier.factorToBase);
    if (factor < 1) continue;
    const count = Math.floor(remaining / factor);
    if (count > 0) {
      out.push({ code: tier.code, count, factorToBase: factor });
      remaining -= count * factor;
    }
    if (remaining === 0) break;
  }

  // Remainder with no factor-1 UOM to absorb it: surface it as base 'each'.
  if (remaining > 0) {
    const hasBaseTier = tiers.some(t => Math.floor(t.factorToBase) === 1);
    if (!hasBaseTier) {
      out.push({ code: 'each', count: remaining, factorToBase: 1 });
    }
  }
  return out;
}

/** "1 pallet, 1 carton, 8 each" — a compact label from a breakdown. */
export function formatBreakdown(breakdown: readonly UomBreakdown[]): string {
  return breakdown.map(b => `${b.count} ${b.code}`).join(', ');
}
