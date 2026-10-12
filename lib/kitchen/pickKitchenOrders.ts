// Which of a venue's orders a "repeat that" button should offer.
//
// One definition, shared by the kitchen screen (`views/KitchenHomeView.tsx`) and
// the Shop's Reorder (`hooks/useOrderingState.ts` -> `lastOrderForHoReCa`), so the
// two cannot disagree about what "the last order" is. Pure, and import-light on
// purpose: the Shop hook is core, shipped to every tenant, while the planner that
// re-exports this (`reorderPlan.ts`) belongs to the shop module.

import type { Order } from '@/types'

/**
 * The venue's orders newest first, split into what the Kitchen screen shows:
 * the one to offer "same again" on (the newest that was not cancelled -- a
 * cancelled order is a poor thing to repeat unprompted) and the last few for the
 * "Recent orders" list (cancelled ones included, so the list matches History).
 */
export function pickKitchenOrders<T extends Pick<Order, 'orderDate' | 'status' | 'hoReCa'>>(
  orders: readonly T[],
  hoReCaId: number | null | undefined,
  recentCount = 3,
): { hero: T | null; recent: T[] } {
  if (hoReCaId == null) return { hero: null, recent: [] }
  const mine = orders
    .filter((o) => o.hoReCa.id === hoReCaId)
    .sort((a, b) => Date.parse(b.orderDate) - Date.parse(a.orderDate))
  return {
    hero: mine.find((o) => o.status !== 'cancelled') ?? null,
    recent: mine.slice(0, recentCount),
  }
}
