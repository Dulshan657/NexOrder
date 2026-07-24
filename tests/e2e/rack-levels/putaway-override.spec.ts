// Rack levels — the manual override path (role-mismatch warning + "Place
// anyway").
//
// Builds its own levelled, published rack in the permanent "E2E RackLevels
// Test" fixture warehouse (helpers.ensureLevelledFixtureRack) — never
// converts a MAIN rack (MAIN holds live stock; see CLAUDE.md/putaway-roles.
// spec.ts's header for why).
//
// CONFIRMED PRODUCT BUG (see the E2E runner's report for detail): the
// role-mismatch EXPLAINABILITY UI never activates. `supabase/functions/
// _shared/wie/scoring.ts` — the only producer of this hard-filter reason —
// emits `code: 'level_role_mismatch'` (lower-snake), but all three frontend
// consumers (`components/inventory/PutawayExplanationCard.tsx`, `.../
// putaway/PutawayRow.tsx`, `.../putaway/BinPickerSheet.tsx`) compare against
// the literal `'LEVEL_ROLE_MISMATCH'` (upper-snake). `HardFilterReason.code`
// is typed as a bare `string`, so tsc never caught the casing mismatch. Net
// effect: a wedged row never gets its amber "Choose bin" treatment or its
// descriptive reason, and BinPickerSheet's wedge banner never renders — even
// though the underlying data (the row really is wedged) and the actual
// override mechanics (pick a mismatched bin manually → "Place anyway" →
// role_override: true, gated by `putawayGuards.isLevelRoleMismatch`, which
// does NOT depend on this code string) work fine. The soft assertions below
// document the broken UI without blocking verification of the mechanism
// underneath it.
import { expect, test } from '../fixtures/auth'
import {
  ensureLevelledFixtureRack,
  FIXTURE_WAREHOUSE_CODE,
  FIXTURE_WAREHOUSE_NAME,
  openProductEdit,
  openProducts,
  pickReceivingSearchResult,
  openPutawayQueue,
  openReceiving,
  selectPutawayWarehouse,
} from './helpers'

const PRODUCT_NAME = 'Coconut Milk 270ml'
const SUPPLIER_NAME = 'E2E Test Supplier'

test.describe('Rack levels — putaway override', () => {
  test('a role-mismatched queue line can still be placed with "Place anyway"', async ({ adminPage: page }) => {
    test.slow()
    await ensureLevelledFixtureRack(page)

    // ── Restrict PRODUCT_NAME to "reserve" only — our fixture rack has no
    // reserve-role level (L1-4 pick, L5 bulk), so EVERY candidate level is a
    // mismatch and the line is guaranteed to wedge (no eligible bin). ────────
    await openProducts(page)
    await openProductEdit(page, PRODUCT_NAME)
    await expect(page.getByText('Allowed level roles')).toBeVisible()

    const pick = page.getByLabel('pick', { exact: true })
    const bulk = page.getByLabel('bulk', { exact: true })
    const reserve = page.getByLabel('reserve', { exact: true })
    const original = { pick: await pick.isChecked(), bulk: await bulk.isChecked(), reserve: await reserve.isChecked() }

    try {
      if (original.pick) await pick.uncheck()
      if (original.bulk) await bulk.uncheck()
      if (!original.reserve) await reserve.check()
      await page.getByRole('button', { name: /save attributes/i }).click()
      await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5_000 })
      // ProductForm has no discard-confirm guard — it's just left open
      // (blocking every later click with its backdrop) unless closed here.
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()

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

      await openPutawayQueue(page)
      await selectPutawayWarehouse(page, FIXTURE_WAREHOUSE_CODE)

      const row = page.locator('div.px-4.py-3', {
        has: page.getByRole('button', { name: `Why this bin for ${PRODUCT_NAME}?` }),
      })
      await expect(row).toBeVisible({ timeout: 10_000 })

      // BUG: should show the engine's hard-filter label (LEVEL_ROLE_MISMATCH)
      // and amber styling; actually falls back to the generic wedge copy
      // because of the casing bug documented above.
      await expect.soft(row.getByText('No eligible bin')).toHaveCount(0)
      await expect.soft(row.getByRole('button', { name: 'Choose bin' })).toHaveClass(/text-amber-700/)

      await row.getByRole('button', { name: 'Choose bin' }).click()
      await expect(page.getByText('Choose a bin')).toBeVisible()

      // BUG: the wedge banner (isWedged && hardFilters includes the
      // mismatch) never renders for the same casing reason.
      await expect.soft(page.getByText(/pick a bin below and confirm with/i)).toBeVisible()

      // The override mechanism itself does NOT depend on the broken code
      // string (putawayGuards.isLevelRoleMismatch compares levelRole/
      // allowedLevelRoles directly) — every browsable bin here is one of our
      // 5 mismatched levels, so the first one works.
      const mismatchedBinButton = page.getByText(/level$/).first()
      await mismatchedBinButton.click()
      await expect(page.getByText(/this is the engine's hard rule/i)).toBeVisible()
      await page.getByRole('button', { name: 'Place anyway' }).click()

      await expect(row).toHaveCount(0, { timeout: 10_000 })
    } finally {
      await openProducts(page)
      await openProductEdit(page, PRODUCT_NAME)
      const pickAgain = page.getByLabel('pick', { exact: true })
      const bulkAgain = page.getByLabel('bulk', { exact: true })
      const reserveAgain = page.getByLabel('reserve', { exact: true })
      if ((await pickAgain.isChecked()) !== original.pick) await pickAgain.click()
      if ((await bulkAgain.isChecked()) !== original.bulk) await bulkAgain.click()
      if ((await reserveAgain.isChecked()) !== original.reserve) await reserveAgain.click()
      await page.getByRole('button', { name: /save attributes/i }).click()
      await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5_000 })
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
  })
})
