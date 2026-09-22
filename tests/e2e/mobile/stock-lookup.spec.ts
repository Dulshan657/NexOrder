// The Stock tab at 360 px: a scan surface for the Warehouse role, and a list
// that is no longer a sideways-scrolling table.
//
// ── WHAT ONLY THIS FILE CAN SEE ─────────────────────────────────────────────
//
// Two of the three things being guarded here are invisible to every other tier:
//
//   - The dock's position. `sticky bottom-0` is bounded by its containing
//     block, so rendering it anywhere but last still pins it while reserving a
//     blank band at the top of the page. jsdom has no layout and neither CI
//     guard matches it — `check-overlays` looks for `fixed inset-0`,
//     `check-viewport-units` for `vh`.
//   - The container-query conversion of the ops list. jsdom applies no
//     Tailwind, so `@min-[780px]:contents` computes to nothing there and
//     `toBeVisible()` passes for everything. Horizontal overflow at 360 px is
//     the assertion that the grid actually collapses.
//
// The third is ordinary but load-bearing: exactly ONE live scan field. Two
// would mean a scan landing in whichever happened to hold focus, which on an
// RS35 under Input Method mode is not something the operator can see happening.
import { expect, test } from '../fixtures/auth'
import {
  expectNoHorizontalOverflow,
  expectPinnedToFoot,
  expectTouchTarget,
  navigateTo,
} from './helpers'

const SCAN_FIELD = '[data-scan-field]'

test.describe('Stock lookup on a handheld', () => {
  test('the Warehouse role lands on the scanner, with the dock at the foot', async ({ warehousePage: page }) => {
    await navigateTo(page, 'Stock')

    // Role-derived default, not viewport-derived — see StockView's comment for
    // why that distinction is what makes this assertable at all.
    await expect(page.getByRole('heading', { name: /Scan to look something up/i })).toBeVisible()

    const field = page.locator(SCAN_FIELD)
    await expect(field).toHaveCount(1)
    await expectTouchTarget(field, 'lookup scan field')

    await expectPinnedToFoot(page, 'stock lookup dock (page top)')
    await expectNoHorizontalOverflow(page)
  })

  test('the dock holds while the page scrolls', async ({ warehousePage: page }) => {
    await navigateTo(page, 'Stock')
    await expect(page.locator(SCAN_FIELD)).toBeVisible()

    await page.evaluate(() => {
      const el = document.querySelector('main[data-scroll-container]')
      if (el) el.scrollTop = el.scrollHeight
    })

    // Where an un-pinned dock gives itself away: it scrolls off with the
    // content it was laid out inside.
    await expectPinnedToFoot(page, 'stock lookup dock (page bottom)')
    await expectNoHorizontalOverflow(page)
  })

  test('an unrecognised code is quoted back, not swallowed', async ({ warehousePage: page }) => {
    await navigateTo(page, 'Stock')

    const field = page.locator(SCAN_FIELD)
    await field.fill('ZZ-NOT-A-REAL-CODE')
    await field.press('Enter')

    // Stage 2 runs a point lookup for a plate before conceding, so wait for the
    // verdict rather than the intermediate 'Looking up' screen.
    await expect(page.getByText(/No match for that code/i)).toBeVisible()
    await expect(page.getByText('ZZ-NOT-A-REAL-CODE')).toBeVisible()

    // `break-all` on the hero: a long code wraps rather than widening the page.
    await expectNoHorizontalOverflow(page)
    await expectPinnedToFoot(page, 'dock after a miss')
  })

  test('Browse renders the ops list without a horizontal scroll', async ({ warehousePage: page }) => {
    await navigateTo(page, 'Stock')

    const browse = page.getByRole('button', { name: /^Browse$/ })
    await expectTouchTarget(browse, 'Browse segment')
    await browse.click()

    // The list replaced a 5-column table in `overflow-x-auto`. If the container
    // query were written as a viewport breakpoint — the mistake ReceiveLineCard
    // records — this is where the row would overflow.
    await expect(page.getByPlaceholder(/Search by name, SKU/i)).toBeVisible()
    await expectNoHorizontalOverflow(page)

    // The dock belongs to the scanner and must not survive the mode switch,
    // or Browse would carry a second live scan field.
    await expect(page.locator(SCAN_FIELD)).toHaveCount(0)
  })

  test('a stock row opens its batch detail from the keyboard', async ({ warehousePage: page }) => {
    await navigateTo(page, 'Stock')
    await page.getByRole('button', { name: /^Browse$/ }).click()

    const rows = page.locator('ul > li > button[aria-expanded]')

    // Wait for the list to settle BEFORE deciding there is nothing in it. A
    // bare `count()` races the query and skips on a slow network rather than on
    // an empty catalogue — a skip that fires every run measures nothing while
    // looking like it measured something.
    await rows.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    const count = await rows.count()
    test.skip(count === 0, 'no products visible at this warehouse scope')

    const first = rows.first()
    await expectTouchTarget(first, 'stock row disclosure')
    await expect(first).toHaveAttribute('aria-expanded', 'false')

    // The old row was a <tr onClick> with no key handler — mouse-only. This is
    // the assertion that keeps it reachable.
    await first.focus()
    await page.keyboard.press('Enter')
    await expect(first).toHaveAttribute('aria-expanded', 'true')
    await expectNoHorizontalOverflow(page)
  })
})
