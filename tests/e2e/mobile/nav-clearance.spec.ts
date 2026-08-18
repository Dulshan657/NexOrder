// Guards F8: the mobile ☰ sat on top of the warehouse selector.
//
// `fixed top-4 left-4`, `md:hidden`, and no inventory page reserved space for
// it — so on the RS35 the site selector was unreachable on Stocktake, Putaway,
// Replenishment and Receive. The fix was explicit left clearance on those four
// page headers (`pl-16 … md:pl-6`, and `pl-12 md:pl-0` on Receive Stock), which
// is four independent edits and therefore four independent things to lose.
//
// Asserted as OVERLAP, not as visibility. The selector was always visible; it
// was underneath a button, which is a different failure and the one that
// actually cost the operator the page.
import { expect, test } from '../fixtures/auth'
import { navigateTo, overlaps, warehouseSelect } from './helpers'

const PAGES = ['Receive Stock', 'Putaway', 'Replenishment', 'Stocktake'] as const

test.describe('F8 — the ☰ does not cover the site selector', () => {
  for (const item of PAGES) {
    test(`${item}: menu button clears the warehouse selector`, async ({ warehousePage: page }) => {
      await navigateTo(page, item)

      const menu = page.getByRole('button', { name: 'Open menu' })
      await expect(menu).toBeVisible()

      const selector = warehouseSelect(page)
      await expect(selector).toBeVisible()

      expect(
        await overlaps(menu, selector),
        `the ☰ overlaps the warehouse selector on ${item}`,
      ).toBe(false)
    })
  }
})
