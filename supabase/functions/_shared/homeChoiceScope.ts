// home-bin-choices' `recommendationId`, scoped (NX-0033, final review M3).
//
// The id names the putaway line on the stop a Manager is standing at, and its
// own promise to a bin is given back (wie_home_bin_candidate_facts
// p_exclude_rec_ids, mig 00144) so the bin the planner chose is not read as
// full. That is only true of an OPEN line of THIS product at THIS warehouse:
// any other line's space was never this stop's to give back, and the chooser
// would list a bin with room it does not have. Such an id is refused.
//
// Pure, no IO: the function reads the row and asks this.

export const REC_OUT_OF_SCOPE =
  'recommendationId must be an open putaway line of this product at this warehouse'

/** The statuses of a line still waiting to be put away (the ones 00144 excludes). */
const OPEN_STATUSES: ReadonlySet<string> = new Set(['suggested', 'assigned'])

/** Null when the line may give its space back for this product and warehouse, else the refusal. */
export function recommendationScopeRefusal(
  rec: { product_id: number; warehouse_id: number; status: string } | null,
  scope: { productId: number; warehouseId: number },
): string | null {
  if (rec === null) return REC_OUT_OF_SCOPE
  if (Number(rec.product_id) !== scope.productId || Number(rec.warehouse_id) !== scope.warehouseId) {
    return REC_OUT_OF_SCOPE
  }
  return OPEN_STATUSES.has(rec.status) ? null : REC_OUT_OF_SCOPE
}
