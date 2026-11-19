// NX-0042: the dashboard's Order pipeline opens Order Import on the tab that
// holds the orders a stage counts. Admin tabs switch by name only
// (`onNavigateTab('Order Import')`), so the wanted tab rides here for the one
// render that consumes it, rather than as new state threaded through AppShell.

import type { OrderStatus } from '../types'

export type OrderImportTab = 'received' | 'inProgress' | 'completed'

/** Mirrors OrderImportPage's TAB_STATUSES: which tab lists an order in this status. */
export function orderImportTabForStatus(status: OrderStatus): OrderImportTab {
  if (status === 'processing') return 'received'
  if (status === 'processed' || status === 'picked' || status === 'packed') return 'inProgress'
  return 'completed'
}

let requested: OrderImportTab | null = null

/** Ask the next Order Import mount to open on `tab`. */
export function requestOrderImportTab(tab: OrderImportTab): void {
  requested = tab
}

/** Read without clearing — safe inside a state initialiser React may call twice. */
export function peekRequestedOrderImportTab(): OrderImportTab | null {
  return requested
}

/** Clear once the page has mounted, so a later visit opens on its default. */
export function clearRequestedOrderImportTab(): void {
  requested = null
}
