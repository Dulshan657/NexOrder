// Volume (m³) resolution across the UOM ladder (mig 00069). Pure, IO-free.
//
// Volume used to be two product columns — cubic_meters_unit (one base unit) and
// cubic_meters_carton (one carton) — which can't describe an N-level UOM list.
// Each UOM row now carries its own optional m³; a blank one INHERITS
// `factorToBase × cubicMetersUnit` so a product that only fills the per-unit
// field keeps working exactly as before.
import type { ProductUom } from '../types';
import { findUomById, findUomByFactor } from './uom';

/** The product fields this module reads — kept narrow so tests can pass a stub. */
export interface VolumeSource {
    cubicMetersUnit?: number | null;
    cubicMetersCarton?: number | null;
    cartonSize?: number | null;
    uoms?: readonly ProductUom[];
}

/**
 * m³ for ONE of `uom`. Explicit per-UOM volume wins; otherwise it's inherited
 * from the base unit's volume scaled by the factor. Returns undefined (not 0)
 * when neither is known, so callers can tell "no volume data" from "zero".
 */
export function resolveUomVolume(
    product: VolumeSource,
    uom: ProductUom | undefined,
): number | undefined {
    if (uom?.cubicMeters != null) return uom.cubicMeters;
    const perUnit = product.cubicMetersUnit;
    if (perUnit == null) return undefined;
    return perUnit * (uom?.factorToBase ?? 1);
}

/** A cart/order line: a chosen UOM (by id, or legacy by pack factor) and a quantity. */
export interface VolumeLine extends VolumeSource {
    uomId?: number;
    packSize?: number;
}

/**
 * m³ for ONE unit of what the line is being sold in.
 *
 * Resolution order: the line's UOM row (by id, then by pack factor for lines
 * written before uom_id existed) → the legacy cubic_meters_carton when that UOM
 * carries no explicit volume and the line is the legacy carton → the per-unit
 * volume scaled by packSize.
 */
export function resolveLineUnitVolume(line: VolumeLine): number | undefined {
    const factor = line.packSize != null && line.packSize > 1 ? line.packSize : 1;
    const uom = findUomById(line.uoms, line.uomId) ?? findUomByFactor(line.uoms, factor);
    if (uom?.cubicMeters != null) return uom.cubicMeters;

    // The legacy per-carton column still wins over inheritance for the carton
    // tier — mig 00069 backfills it onto the UOM row, but a product whose
    // carton_size never matched a UOM factor would otherwise lose it.
    if (factor > 1 && line.cubicMetersCarton != null && factor === (line.cartonSize ?? factor)) {
        return line.cubicMetersCarton;
    }
    if (line.cubicMetersUnit == null) return undefined;
    return line.cubicMetersUnit * (uom?.factorToBase ?? factor);
}

/** Total m³ for a set of lines. Lines with unknown volume contribute nothing. */
export function totalLineVolume(
    lines: readonly (VolumeLine & { quantity: number })[],
): number {
    return lines.reduce((sum, line) => {
        const each = resolveLineUnitVolume(line);
        return each == null ? sum : sum + each * line.quantity;
    }, 0);
}
