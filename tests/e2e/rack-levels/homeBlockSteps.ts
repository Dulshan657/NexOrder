// Screen steps for putaway-home-block.spec.ts, one function per thing a person
// does. Kept apart from the spec so the spec reads as the story it is proving.
//
// Each one drives the real screens; none of them touches the database.
import type { Locator, Page } from '@playwright/test'
import { expect } from '../fixtures/auth'
import { openPutawayQueue } from './helpers'
import { WORLD_NAMES, type World, type WorldProduct } from './homeBlockWorld'

/** Type a code into a scan field and press Enter, as a scan gun would. */
export async function scan(field: Locator, code: string): Promise<void> {
  await field.fill(code)
  await field.press('Enter')
}

/** The refusal copy every off-home bin gets while the home has room (A1). */
export function homeRoomMessage(homeCode: string, room: number): string {
  return `Put this in its home bin ${homeCode}; it still has room for ${room}. If it is full, ask a manager to set its maximum.`
}

/** The refusal copy for another product's home (A9). */
export function othersHomeMessage(binCode: string, sku: string): string {
  return `${binCode} is the home bin of ${sku}; choose another bin.`
}

/** Nothing on the page that could lift the block: no override, no "Place anyway". */
export async function expectNoWayPastTheBlock(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /override|anyway/i })).toHaveCount(0)
}

// ── Replenishment setup ───────────────────────────────────────────────────────

async function selectWarehouse(page: Page, code: string): Promise<void> {
  const select = page.locator('label', { hasText: 'Warehouse' }).locator('select')
  const value = await select.locator('option', { hasText: `(${code})` }).getAttribute('value')
  if (!value) throw new Error(`No "Warehouse" option contains (${code})`)
  await select.selectOption(value)
}

export async function openMinMaxSetup(page: Page, world: World): Promise<void> {
  await page.getByRole('button', { name: /^Replenishment\b/ }).click()
  await selectWarehouse(page, world.warehouseCode)
  await page
    .getByRole('navigation', { name: 'Replenishment stage' })
    .getByRole('button', { name: /Min\/max setup/ })
    .click()
  await expect(healthPanel(page)).toBeVisible()
}

export function healthPanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Home bin problems' })
}

/** Set `product`'s home on the grid: the bin, a minimum and a maximum, in cartons. */
export async function setHomeBin(
  page: Page,
  product: WorldProduct,
  binCode: string,
  minCartons: number,
  maxCartons: number,
): Promise<void> {
  await page.getByRole('tab', { name: /^All/ }).click()
  await page.getByPlaceholder('Search SKU or name…').fill(product.sku)
  await page.getByLabel(`Home bin for ${product.sku}`).fill(binCode)
  await page.getByLabel(`Minimum for ${product.sku}`).fill(String(minCartons))
  await page.getByLabel(`Maximum for ${product.sku}`).fill(String(maxCartons))
  await page.getByRole('button', { name: /^Save 1$/ }).click()
  await expect(page.getByText(/1 slot saved/)).toBeVisible()
}

export async function checkHomesAgain(page: Page): Promise<void> {
  const panel = healthPanel(page)
  await panel.getByRole('button', { name: 'Check again' }).click()
  // The button disables while it refetches and comes back when it is done.
  await expect(panel.getByRole('button', { name: 'Check again' })).toBeEnabled()
}

// ── Receiving ─────────────────────────────────────────────────────────────────

/** Receive `cartons` cartons of `product`, arriving on a carton plate. */
export async function receiveCartons(page: Page, world: World, product: WorldProduct, cartons: number): Promise<void> {
  await page.getByRole('button', { name: 'Receive Stock', exact: true }).click()
  const next = page.getByRole('button', { name: 'Start next delivery' })
  if (await next.isVisible()) await next.click()

  await page.getByLabel('Supplier').fill(WORLD_NAMES.supplierName)
  await page.getByLabel('Destination warehouse').selectOption({ label: world.warehouseName })
  // Enter in the search box takes the product when the search has narrowed to one.
  await page.getByLabel('Search products').fill(product.sku)
  await page.getByLabel('Search products').press('Enter')
  await page.getByLabel(`Quantity for ${product.name}`).fill(String(cartons))
  await page.getByLabel(`Unit for ${product.name}`).selectOption({ label: `carton (×${product.cartonSize})` })
  // Below the wide layout the plate type sits inside the line's disclosure.
  await page
    .locator('button[aria-expanded]')
    .filter({ hasText: /lot|Pallet|Carton|Barcode/i })
    .first()
    .click()
  // A pallet is a unit load and is never sent to a pick home; cartons are.
  await page.getByLabel(/^Arrived on, for line/).selectOption('carton')
  // Wait for the receipt call itself, so the card is read once it has been answered
  // rather than after a longer guess.
  const booked = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('/functions/v1/receive-stock'),
  )
  await page.getByRole('button', { name: /^Receive 1 line$/ }).click()
  await booked
  await expect(page.getByRole('heading', { name: /Received 1 line/ })).toBeVisible()
}

/** The receive card's "Suggested locations" panel, opened. */
export async function openSuggestions(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Suggested locations/ }).click()
  await expect(page.getByRole('heading', { name: /Put away — recommended bins/ })).toBeVisible()
}

/** Pick another bin for the one suggestion on the receive card and press "Put here". */
export async function putHereInstead(page: Page, binCode: string): Promise<void> {
  await page.getByRole('button', { name: 'Why this bin?' }).click()
  await page.getByLabel('Choose another bin').selectOption({ label: binCode })
  await page.getByRole('button', { name: /Put here/ }).click()
}

// ── Putaway queue ─────────────────────────────────────────────────────────────

/** Assign every suggestion of `product` on the Assign tab: decide the bin, move nothing. */
export async function assignInQueue(page: Page, product: WorldProduct): Promise<void> {
  await openPutawayQueue(page)
  await page.getByRole('navigation', { name: 'Putaway stage' }).getByRole('button', { name: /^Assign/ }).click()
  const row = page.locator('div.px-4.py-3', {
    has: page.getByRole('button', { name: `Why this bin for ${product.name}?` }),
  })
  await row.getByRole('button', { name: 'Assign' }).click()
  await expect(page.getByText(/on the walk now/)).toBeVisible()
}

/**
 * On the Walk tab: open `product`'s stop (assigned to `assignedCode`), identify
 * what is being carried, and scan `scannedCode` as the bin. Stops at the count
 * step, ready to Confirm.
 */
export async function walkAndScanBin(
  page: Page,
  product: WorldProduct,
  assignedCode: string,
  scannedCode: string,
): Promise<void> {
  await page.getByRole('navigation', { name: 'Putaway stage' }).getByRole('button', { name: /^Walk/ }).click()
  await page.getByRole('button').filter({ hasText: product.name }).filter({ hasText: assignedCode }).click()
  const identify = page.getByLabel(/^Scan the (product|plate)/)
  if (await identify.isVisible()) await scan(identify, product.barcode)
  await scan(page.getByLabel(/^Scan the bin/), scannedCode)
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible()
}

export async function confirmCount(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirm' }).click()
}

export async function cancelStop(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cancel this stop' }).click()
}

// ── The deployed function, called as the signed-in person ─────────────────────

async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (/^sb-.+-auth-token$/.test(key)) {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { access_token?: string } | null
        return parsed?.access_token ?? null
      }
    }
    return null
  })
  if (!token) throw new Error('The page holds no signed-in session to call the function with')
  return token
}

export interface FunctionReply {
  readonly status: number
  readonly body: { ok?: boolean; error?: { code?: string; message?: string }; placedElsewhere?: boolean }
}

/**
 * POST to a deployed Edge Function with the page's own session -- the request the
 * app's service makes. Used only where the app has no control that sends it: the
 * floor screens have no "why did it go elsewhere" prompt yet, so the reason on a
 * suggested task cannot be given from a browser.
 */
export async function callFunction(page: Page, name: string, body: unknown): Promise<FunctionReply> {
  const baseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!baseUrl || !anonKey) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (.env.dev.local)')
  const res = await page.request.post(`${baseUrl}/functions/v1/${name}`, {
    headers: { Authorization: `Bearer ${await accessToken(page)}`, apikey: anonKey },
    data: body,
  })
  return { status: res.status(), body: await res.json() }
}
