// Shared navigation helpers for the rack-levels suite. Kept separate from
// tests/e2e/fixtures so they can depend on app-specific text without
// touching the generic auth harness.
import type { Page } from '@playwright/test'

/** Admin sidebar → Settings → "Warehouse" sub-tab (Storage Forms lives here). */
export async function openSettingsWarehouseSubtab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const subtabNav = page.getByRole('navigation', { name: 'Settings sub-navigation' })
  await subtabNav.getByRole('button', { name: 'Warehouse', exact: true }).click()
}

/** Admin sidebar → "Warehouse" (the map viewer / RackedWorkspace). */
export async function openWarehouseTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Warehouse', exact: true }).click()
  await page.getByRole('heading', { name: 'Warehouse', exact: true }).waitFor({ state: 'visible' })
}

/** Admin sidebar → "Putaway" (the putaway queue). Not `exact` — the sidebar
 *  button appends a pending-count badge to its accessible name (e.g.
 *  "Putaway 12") whenever the queue is non-empty. */
export async function openPutawayQueue(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Putaway\b/ }).click()
}

/** Admin sidebar → "Pick Queue". */
export async function openPickQueue(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pick Queue', exact: true }).click()
}

/** Admin sidebar → "Receiving" (Receive Stock form). */
export async function openReceiving(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Receiving', exact: true }).click()
}
