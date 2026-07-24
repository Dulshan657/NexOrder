// Rack levels — putaway respects a SKU's allowed level roles.
//
// Builds its own levelled, published rack in the permanent "E2E RackLevels
// Test" fixture warehouse (helpers.ensureLevelledFixtureRack) rather than
// converting any MAIN rack — MAIN's own storage forms (MAIN_PALLET_BAY etc.)
// all still have has_levels=false and no MAIN rack has been converted, so
// this behaviour genuinely cannot be exercised against MAIN without
// converting a rack that holds live stock, which this suite must never do.
//
// This test edits a real catalogue product's WMS attributes (a prod write,
// restored in `finally`) and receives a small quantity of real stock into the
// fixture warehouse (a prod write that stays inside the fixture warehouse's
// own scratch stock). ProductForm (components/ProductForm.tsx) is a plain
// modal with its own "Cancel" button and no discard-confirm guard — it must
// be explicitly closed after each attributes save or it's left open, blocking
// every later click with its backdrop.
import { expect, test } from '../fixtures/auth'
import {
  ensureLevelledFixtureRack,
  FIXTURE_BIN_CODE,
  FIXTURE_WAREHOUSE_CODE,
  FIXTURE_WAREHOUSE_NAME,
  openProductEdit,
  openProducts,
  pickReceivingSearchResult,
  openPutawayQueue,
  openReceiving,
  selectPutawayWarehouse,
} from './helpers'

const PRODUCT_NAME = 'Coconut Milk 140ml'
const SUPPLIER_NAME = 'E2E Test Supplier'

test.describe('Rack levels — putaway role gate', () => {
  test('restricting a product to "bulk" routes its putaway to the bulk level', async ({ adminPage: page }) => {
    test.slow()
    await ensureLevelledFixtureRack(page)

    // ── Restrict PRODUCT_NAME to bulk-only levels (restore after) ──────────
    await openProducts(page)
    await openProductEdit(page, PRODUCT_NAME)
    await expect(page.getByText('Allowed level roles')).toBeVisible()

    const pick = page.getByLabel('pick', { exact: true })
    const reserve = page.getByLabel('reserve', { exact: true })
    const bulk = page.getByLabel('bulk', { exact: true })
    const original = { pick: await pick.isChecked(), reserve: await reserve.isChecked(), bulk: await bulk.isChecked() }

    try {
      if (original.pick) await pick.uncheck()
      if (original.reserve) await reserve.uncheck()
      if (!original.bulk) await bulk.check()
      await page.getByRole('button', { name: /save attributes/i }).click()
      await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5_000 })
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()

      // ── Receive a small quantity into the fixture warehouse ────────────
      await openReceiving(page)
      await page.getByLabel('Supplier').fill(SUPPLIER_NAME)
      // ReceiveStockView's destination <option> is the bare warehouse name —
      // no "(code)" suffix, unlike WarehousePicker/PutawayQueuePage.
      await page.getByLabel('Destination warehouse').selectOption({ label: FIXTURE_WAREHOUSE_NAME })
      await page.getByLabel('Search products').fill(PRODUCT_NAME)
      await pickReceivingSearchResult(page, PRODUCT_NAME)
      await page.getByRole('spinbutton').first().fill('2')
      await page.getByRole('button', { name: /^Receive 1 line$/ }).click()
      await expect(page.getByText(/received 1 line/i)).toBeVisible({ timeout: 10_000 })

      // ── The putaway queue should recommend the L5 (bulk) level ─────────
      await openPutawayQueue(page)
      await selectPutawayWarehouse(page, FIXTURE_WAREHOUSE_CODE)
      // .first() — repeated suite runs each queue their own line for this
      // product, so more than one row can legitimately show the same L5
      // recommendation; any one of them proves the role-based routing works.
      await expect(page.getByText(`${FIXTURE_BIN_CODE}-L5`).first()).toBeVisible({ timeout: 10_000 })
    } finally {
      // Restore the product's allowed level roles no matter what happened above.
      await openProducts(page)
      await openProductEdit(page, PRODUCT_NAME)
      const pickAgain = page.getByLabel('pick', { exact: true })
      const reserveAgain = page.getByLabel('reserve', { exact: true })
      const bulkAgain = page.getByLabel('bulk', { exact: true })
      if ((await pickAgain.isChecked()) !== original.pick) await pickAgain.click()
      if ((await reserveAgain.isChecked()) !== original.reserve) await reserveAgain.click()
      if ((await bulkAgain.isChecked()) !== original.bulk) await bulkAgain.click()
      await page.getByRole('button', { name: /save attributes/i }).click()
      await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5_000 })
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
  })
})
