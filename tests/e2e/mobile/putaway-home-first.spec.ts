// NX-0007 end to end at 360 px, as the Warehouse role: receive a product that
// has a home bin, press "Put away now", then scan the product, scan the bin and
// press Enter. No Assign step and no tap to open a card.
//
// WRITES to dev, deliberately: a receipt of a few units of Coconut Milk, put
// away into its home bin (MAIN-F01-R09), or beside it once that is full. Each run is its own small receipt,
// referenced "E2E putaway <time>", so runs never collide. The short-count test
// leaves 2 units flagged short at the dock, which is the point of that path —
// a manager resolves it on the Desk tab.
import { expect, test } from '../fixtures/auth'
import { type Page } from '@playwright/test'
import { expectNoHorizontalOverflow, navigateTo, scanDock } from './helpers'

const BARCODE = '9312000000036' // Coconut Milk 400ml, homed at MAIN-F01-R09 on dev
const HOME_BIN = 'MAIN-F01-R09'

/** Receive `qty` units through the real Receive Stock screen and land on
 *  Putaway via "Put away now". */
async function receiveAndOpenPutaway(page: Page, qty: number): Promise<void> {
  await navigateTo(page, 'Receive Stock')
  await page.getByLabel('Supplier').fill(`E2E putaway ${Date.now()}`)
  await page.getByLabel('Supplier').press('Tab')

  const search = page.getByLabel('Search products')
  await search.fill(BARCODE)
  await search.press('Enter')

  const qtyField = page.getByLabel(/^Quantity for Coconut Milk/).first()
  await expect(qtyField).toBeVisible()
  await qtyField.fill(String(qty))

  const expiry = page.getByLabel(/^Expiry for Coconut Milk/).first()
  if (await expiry.isVisible().catch(() => false)) await expiry.fill('2027-12-31')

  await scanDock(page).getByRole('button', { name: /^Receive/ }).click()
  await page.getByRole('button', { name: /Put away now/ }).click({ timeout: 20_000 })

  // Filtered to this delivery, with the way out offered.
  await expect(page).toHaveURL(/[?&]receipt=\d+/)
  await expect(page.getByRole('button', { name: /Show all/ })).toBeVisible()
}

/** The open stop's task quantity, from its "of N on this task" line. */
async function taskQuantity(page: Page): Promise<number> {
  const text = await page.getByText(/of [\d.]+ on this task/).first().textContent()
  return Number(/of ([\d.]+) on this task/.exec(text ?? '')?.[1] ?? NaN)
}

/** A wedge scan: the code then Enter, into the focused scan field. */
async function scan(page: Page, label: RegExp, code: string): Promise<void> {
  const field = page.getByLabel(label).first()
  await field.fill(code)
  await field.press('Enter')
}

const BIN_LABEL = /Scan the bin — expecting (\S+)/

/** The bin the open stop is asking for, read off its own scan field. */
async function expectedBin(page: Page): Promise<string> {
  const field = page.getByLabel(BIN_LABEL).first()
  await expect(field).toBeVisible()
  const label = await field.getAttribute('aria-label') ?? await page.getByText(BIN_LABEL).first().textContent()
  const code = BIN_LABEL.exec(label ?? '')?.[1]
  expect(code, 'the bin step names its bin').toBeTruthy()
  return code as string
}

/** Scan the bin the stop asks for, then accept the prefilled count with Enter.
 *  Returns the bin it went to. */
async function placeOneShare(page: Page): Promise<string> {
  const bin = await expectedBin(page)
  await scan(page, BIN_LABEL, bin)
  const qtyField = page.getByLabel('How much did you put away?')
  const taskQty = await taskQuantity(page)
  expect(taskQty).toBeGreaterThan(0)
  await expect(qtyField).toHaveValue(String(taskQty))
  await qtyField.press('Enter')
  await expect(page.getByText(`Placed in ${bin}`).first()).toBeVisible({ timeout: 15_000 })
  return bin
}

/** Place any further shares the walk opens by itself (home full → overflow). */
async function finishRun(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    if (!(await page.getByLabel(BIN_LABEL).first().isVisible().catch(() => false))) return
    await placeOneShare(page)
  }
}

test.describe('NX-0007 — putaway is scan, scan, Enter', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  test('happy path: one product scan, then bin scan + Enter per share, no taps', async ({ warehousePage: page }) => {
    await receiveAndOpenPutaway(page, 6)

    // No Assign step anywhere on the screen.
    await expect(page.getByRole('tab', { name: /Assign/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Assign/ })).toHaveCount(0)

    await scan(page, /Scan a plate, carton or bin/, BARCODE)

    // Straight to the bin step: no chooser, no tap to open a card. The first
    // share goes home while the home bin has room (it fills up over repeated
    // runs on dev, after which everything is overflow beside it).
    await expect(page.getByRole('group', { name: 'Choose what to put away' })).toHaveCount(0)
    const first = await expectedBin(page)
    await expect(page.getByText(first === HOME_BIN ? 'Home bin' : /Overflow|Home bin/).first()).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // Every share of this delivery, each one bin scan + Enter. After the home
    // share the overflow share opens by itself — the product is not rescanned.
    const bins = [await placeOneShare(page)]
    while (await page.getByLabel(BIN_LABEL).first().isVisible().catch(() => false)) {
      bins.push(await placeOneShare(page))
      expect(bins.length, 'a bounded number of shares').toBeLessThan(6)
    }
    test.info().annotations.push({ type: 'bins', description: bins.join(' → ') })

    // Nothing of this delivery left to put away.
    await expect(page.getByText(/Nothing to put away|All put away|No open putaway/i).first()).toBeVisible({ timeout: 15_000 })
  })

  test('Back steps out one stage at a time and writes nothing', async ({ warehousePage: page }) => {
    await receiveAndOpenPutaway(page, 1)
    await scan(page, /Scan a plate, carton or bin/, BARCODE)

    const bin = await expectedBin(page)
    await scan(page, BIN_LABEL, bin)
    await expect(page.getByLabel('How much did you put away?')).toBeVisible()

    await page.getByRole('button', { name: /^Back/ }).click()
    await expect(page.getByLabel(BIN_LABEL).first()).toBeVisible()
    await expect(page.getByLabel('How much did you put away?')).toHaveCount(0)

    // Finish it, so the run leaves no open task behind.
    await placeOneShare(page)
    await finishRun(page)
  })

  test('a short count asks, then flags the rest for a manager', async ({ warehousePage: page }) => {
    await receiveAndOpenPutaway(page, 1)
    await scan(page, /Scan a plate, carton or bin/, BARCODE)

    const bin = await expectedBin(page)
    await scan(page, BIN_LABEL, bin)

    // Short by ONE: the share opened may be small (a home bin with little room
    // left splits a carton into a few cans home and the rest beside it).
    const qtyField = page.getByLabel('How much did you put away?')
    const taskQty = await taskQuantity(page)
    expect(taskQty, 'a share large enough to be short of').toBeGreaterThanOrEqual(2)
    await qtyField.fill(String(taskQty - 1))
    await qtyField.press('Enter')

    const shortGroup = page.getByRole('group', { name: 'Short count' })
    await expect(shortGroup).toContainText(/Short by 1/)
    await shortGroup.getByRole('button', { name: /Flag 1 short/ }).click()

    await expect(page.getByText(/1 flagged short for a manager/).first()).toBeVisible({ timeout: 15_000 })
    await finishRun(page)
  })
})
