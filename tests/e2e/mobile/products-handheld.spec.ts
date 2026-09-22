// The Products tab at 360 px.
//
// It was a ten-column table with no search, no filter and no pagination: every
// product in the catalogue, in one row each, reachable only by scrolling
// sideways. On a phone that is not a degraded experience, it is no experience.
//
// ── THIS SPEC NEEDS AN ADMIN LOGIN ──────────────────────────────────────────
//
// `adminPage`, not `warehousePage`. Products is deliberately absent from
// `TABS_BY_ROLE.Warehouse` (lib/adminTabUrl.ts) — floor staff reach product
// data through the Stock lookup instead — so the role the rest of this
// directory runs as literally cannot open the screen under test. That means
// E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD must be set, which is a wider
// requirement than the other mobile specs have; `tests/e2e/fixtures/env.ts`
// says so if they are missing.
import { expect, test } from '../fixtures/auth'
import { expectNoHorizontalOverflow, expectTouchTarget, navigateTo } from './helpers'

test.describe('Products on a handheld', () => {
  test('the ten-column table collapses without a sideways scroll', async ({ adminPage: page }) => {
    await navigateTo(page, 'Products')

    const search = page.getByLabel(/Search products by name/i)
    await expect(search).toBeVisible()
    await expectTouchTarget(search, 'product search')
    await expectNoHorizontalOverflow(page)

    // Identity and stock stay visible at every width; the rest collapses.
    const toggles = page.locator('ul > li button[aria-expanded]')
    await toggles.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    const count = await toggles.count()
    test.skip(count === 0, 'no products in the catalogue at this scope')

    const first = toggles.first()
    await expectTouchTarget(first, 'row disclosure')
    await expect(first).toHaveAttribute('aria-expanded', 'false')
    await first.click()
    await expect(first).toHaveAttribute('aria-expanded', 'true')

    // Edit and Delete were 14 px text links. On a 360 px screen a gloved thumb
    // misses one and hits the other.
    await expectTouchTarget(page.getByRole('button', { name: /^Edit / }).first(), 'Edit')
    await expectTouchTarget(page.getByRole('button', { name: /^Delete / }).first(), 'Delete')
    await expectNoHorizontalOverflow(page)
  })

  test('search narrows the list and the count says by how much', async ({ adminPage: page }) => {
    await navigateTo(page, 'Products')

    const search = page.getByLabel(/Search products by name/i)
    await expect(page.getByText(/^\d+ products$/)).toBeVisible()

    await search.fill('zzzzz-no-such-product')
    // The filtered-empty state must name what is still there, or a narrow
    // filter and an empty catalogue read identically.
    await expect(page.getByText(/No products match those filters/i)).toBeVisible()
    await expect(page.getByText(/products are in the catalogue at this scope/i)).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('narrowing the list drops rows out of the selection', async ({ adminPage: page }) => {
    await navigateTo(page, 'Products')

    // The TAPPABLE area is the <label>, not the 13px <input> inside it —
    // `getByLabel` resolves to the control, which is the thing a screen reader
    // announces and a keyboard tabs to, but not the thing a thumb aims at.
    // Asserting the input here would fail while the screen was perfectly
    // usable, and "fix" it by inflating a checkbox nobody taps directly.
    await expectTouchTarget(
      page.locator('label').filter({ hasText: 'Select all visible' }),
      'select all (label hit area)',
    )

    const selectAll = page.getByLabel('Select all visible products')
    await selectAll.check()
    const bulkBar = page.getByTestId('bulk-selection-bar')
    await expect(bulkBar).toContainText('selected')

    // The selection is intersected with what is VISIBLE, so a filter that
    // excludes a selected row must drop it — otherwise the bulk brand action
    // would re-brand rows the operator can no longer see.
    await page.getByLabel(/Search products by name/i).fill('zzzzz-no-such-product')
    await expect(bulkBar).toHaveCount(0)
  })
})
