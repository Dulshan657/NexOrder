// Pure capacity math for storage forms (mig 00061). A form's soft slot capacity
// is either STRUCTURED (levels × positions-per-level) or a FLAT slot count.
// Shared by the Storage Forms editor and any caller that needs the effective
// default_capacity_slots a form contributes. No I/O — trivially unit-testable.

export type CapacityMode = 'structured' | 'flat'

export interface CapacityInput {
  mode: CapacityMode
  levels?: number | null
  positionsPerLevel?: number | null
  /** Manual slot count used when mode === 'flat'. */
  flatSlots?: number | null
}

/**
 * The effective default slot capacity for a form:
 *  - structured: levels × positionsPerLevel (null unless BOTH are positive)
 *  - flat: the manual count (null when unset)
 * null means "uncounted" (no slot ceiling).
 */
export function deriveCapacitySlots(input: CapacityInput): number | null {
  if (input.mode === 'structured') {
    const levels = input.levels ?? 0
    const positions = input.positionsPerLevel ?? 0
    if (levels > 0 && positions > 0) return levels * positions
    return null
  }
  const flat = input.flatSlots
  return flat != null && flat >= 0 ? flat : null
}

/** Pick the capacity mode implied by a stored form (structured when it has levels). */
export function capacityModeOf(form: { levels?: number | null; positionsPerLevel?: number | null }): CapacityMode {
  return form.levels != null && form.positionsPerLevel != null ? 'structured' : 'flat'
}
