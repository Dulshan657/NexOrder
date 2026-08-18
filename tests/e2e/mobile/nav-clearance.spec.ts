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

/**
 * What the ☰ must not cover, per page.
 *
 * Receive Stock is the odd one out and deliberately so: for a Warehouse-role
 * account the destination is LOCKED to their own site ("You can only receive at
 * your site"), so there is no selector there to collide with — the thing the
 * clearance protects is the page's own heading block. Asserting a selector
 * there would fail for a correct page.
 */
const PAGES: ReadonlyArray<{ item: string; target: 'warehouse-select' | 'heading' }> = [
  { item: 'Receive Stock', target: 'heading' },
  { item: 'Putaway', target: 'warehouse-select' },
  { item: 'Replenishment', target: 'warehouse-select' },
  { item: 'Stocktake', target: 'warehouse-select' },
]

test.describe('F8 — the ☰ does not cover the page controls', () => {
  for (const { item, target } of PAGES) {
    test(`${item}: menu button clears the header`, async ({ warehousePage: page }) => {
      await navigateTo(page, item)

      const menu = page.getByRole('button', { name: 'Open menu' })
      await expect(menu).toBeVisible()

      const subject =
        target === 'warehouse-select'
          ? warehouseSelect(page)
          : page.getByRole('heading', { name: item }).first()
      await expect(subject).toBeVisible()

      expect(
        await overlaps(menu, subject),
        `the ☰ overlaps the header content on ${item}`,
      ).toBe(false)
    })
  }
})
