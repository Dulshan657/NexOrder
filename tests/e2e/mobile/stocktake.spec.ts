// Guards F24 (the sticky action bar had no `flex-wrap`, so at 360 px the Post
// label wrapped inside its own button) and E1 (both demo Warehouse accounts had
// `home_warehouse_id = NULL`, so the sheet was read-only for the only role that
// counts stock, and nothing in the register was watching).
//
// The two belong in one spec because they fail at the same place: an operator
// standing at a bin, unable to record what they just counted. One is layout,
// one is data, and neither is visible from a desktop admin session.
//
// Read-mostly: this fills nothing and presses Post never. `count-bin` writes a
// stocktake_variance and there is no undo for it.
import { expect, test } from '../fixtures/auth'
import { expectNoHorizontalOverflow, navigateTo } from './helpers'

test.describe('F24 / E1 — the stocktake sheet is usable on a handheld', () => {
  test('the count sheet opens for the Warehouse role at its home site', async ({
    warehousePage: page,
  }) => {
    await navigateTo(page, 'Stocktake')

    // Any stock-holding location is countable, including the site ROOT — which
    // is how bulk and floor-stacked stock is counted at all, and which is
    // always present, so this does not depend on a published layout.
    await page.getByRole('button', { name: /Site root · bulk/ }).first().click()

    // E1. `canWork` is false when a Warehouse account's home site is not the
    // selected one, which is exactly what a NULL home_warehouse_id produced —
    // for every site, permanently.
    await expect(
      page.getByText('This is not your home warehouse'),
    ).toHaveCount(0)

    // The proof `canWork` is true: the sheet's own controls are live.
    await expect(page.getByLabel('Note (optional)')).toBeEnabled()

    await expectNoHorizontalOverflow(page)
  })

  test('the sticky action bar wraps rather than squeezing the Post label', async ({
    warehousePage: page,
  }) => {
    await navigateTo(page, 'Stocktake')
    await page.getByRole('button', { name: /Site root · bulk/ }).first().click()

    const post = page.getByRole('button', { name: /^Post/ })
    await expect(post).toBeVisible()

    // F24's actual symptom: the label wrapping INSIDE the button. A single line
    // of 14px text is ~20px tall; the button's own padding brings a healthy one
    // to roughly 36-40px. Two lines clears 52. Measuring the button rather than
    // the bar is deliberate — the bar wrapping is the fix, and the button
    // growing is the bug.
    const box = await post.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height, 'Post label wrapped inside its own button').toBeLessThan(52)

    // `ml-auto` on the button group, not `justify-between`: justify-content
    // applies per flex LINE, so wrapping alone would drop the buttons hard-left
    // on row two. Assert they are still on the right of their own row.
    expect(box!.x + box!.width).toBeGreaterThan(180)

    await expectNoHorizontalOverflow(page)
  })
})
