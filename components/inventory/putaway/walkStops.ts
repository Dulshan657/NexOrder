// Two small readings of a Walk stop, shared by the Walk list, its scan finder
// and the stop card (NX-0033).
//
// The Walk lists two kinds of line (getWalkPutaways, wie_putaway_stops):
//
//   * an ASSIGNED line: a bin was decided, by the system when the line was
//     received or by the desk, and the stock is waiting at the dock to be carried;
//   * an OVERFLOW line awaiting confirmation: the product's home was full, the
//     engine suggested another bin, and nobody has said yes to it yet. It has a
//     suggested bin and NO assigned bin. A single-product pallet (unit_load) is
//     never one: it is not held to the home, so its home cannot be "full" for it,
//     even though the planner tags it `overflow` and it can return to
//     `suggested` when the walker puts it back on the queue.
//
// Pure, no IO: the predicate restates the SQL one so the browser and the
// database cannot disagree about which lines need a person's yes.

import type { PendingPutawayRow } from '@/services/supabase/putawayQueueService'

/**
 * Does this line wait for someone to confirm its overflow bin? A suggested line
 * whose bin was chosen because the home is full, which has a bin to confirm, and
 * which is not a single-product pallet (a unit load never waits, C5).
 * Scanning that bin on the Walk, or Assign / Choose bin at the desk, settles it,
 * and the first to do so wins.
 *
 * It is a property of the line, not of which list shows it, so an overflow line
 * made before NX-0033 and still in the Assign queue counts too.
 */
export function isOverflowConfirmStop(
  row: Pick<PendingPutawayRow, 'status' | 'suggestionSource' | 'recommendedLocationId' | 'unitLoad'>,
): boolean {
  return row.status === 'suggested'
    && row.suggestionSource === 'overflow'
    && row.recommendedLocationId != null
    && !row.unitLoad
}

/**
 * The bin a Walk stop is at: the assigned bin, else the suggested one (an
 * overflow line awaiting confirmation has not been assigned anywhere yet).
 * Matches wie_putaway_stops' COALESCE(assigned_location_id, recommended_location_id).
 */
export function walkBinId(
  row: Pick<PendingPutawayRow, 'assignedLocationId' | 'recommendedLocationId'>,
): number | null {
  return row.assignedLocationId ?? row.recommendedLocationId
}
