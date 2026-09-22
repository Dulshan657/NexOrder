// The scan dock: pinned to the FOOT of the screen on the two scan-gun surfaces,
// and staying there.
//
// ── WHY THESE ARE NUMBERS AND NOT A LOOK ────────────────────────────────────
//
// The dock moved from `sticky top-0` to `sticky bottom-0` so it sits under the
// thumb of someone holding an RS35 one-handed at a dock face. `sticky` is
// bounded by its CONTAINING BLOCK, which makes two mistakes possible and both
// of them look almost right:
//
//   - render it anywhere but last, and it un-pins the moment the content below
//     it scrolls into view — the same trap written up in RackedWorkspace, where
//     a bottom-pinned panel carried the operator away from its Apply button;
//   - leave it first and merely flip the edge, and it pins correctly while
//     reserving its ~60 px of flow space as a blank white band at the top.
//
// Neither is visible in a screenshot of the top of the page, and neither CI
// guard can see it: `check-overlays` matches `fixed inset-0`, and
// `check-viewport-units` matches `vh`. So the dock's position is asserted here,
// at both ends of the scroll, or it is not asserted at all.
//
// The Putaway half is DATA-DEPENDENT and skips with a stated reason, in the
// same spirit as F16/F17 in touch-targets.spec.ts.
import { expect, test } from '../fixtures/auth'
import {
  VIEWPORT_H,
  expectNoHorizontalOverflow,
  expectPinnedToFoot,
  expectTouchTarget,
  navigateTo,
  scanDock,
} from './helpers'

test.describe('the scan dock is pinned to the foot, at both ends of the scroll', () => {
  test('Receive Stock: the dock holds while the page scrolls', async ({ warehousePage: page }) => {
    await navigateTo(page, 'Receive Stock')

    const field = page.getByLabel('Search products')
    await expect(field).toBeVisible()
    await expectTouchTarget(field, 'dock scan field')

    // At the top of the page. This is the assertion that fails if the JSX was
    // left in its old position and only the prop was flipped — the bar would
    // still pin, but a blank band would occupy its old slot and the page would
    // be one bar taller than it should be.
    await expectPinnedToFoot(page, 'dock (page top)');

    // And at the bottom, which is where an un-pinned dock gives itself away:
    // Receive Stock renders plate labels, a putaway panel and the recent-receipts
    // list below the staged lines, and every one of them used to sit after the
    // bar.
    await page.evaluate(() => {
      const main = document.querySelector('main[data-scroll-container]')
      if (main) main.scrollTop = main.scrollHeight
    })
    await expect(field).toBeVisible()
    await expectPinnedToFoot(page, 'dock (page bottom)')

    await expectNoHorizontalOverflow(page)
  })

  test('Putaway: the dock holds at both ends of the queue', async ({ warehousePage: page }) => {
    await navigateTo(page, 'Putaway')

    // The dock only renders once the tasks query resolves, so this MUST wait
    // rather than read `isVisible()` straight after navigating — otherwise the
    // skip below fires on every run and the test silently measures nothing,
    // which is the failure mode it is meant to prevent.
    const hasWork = await scanDock(page)
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)

    test.skip(
      !hasWork,
      'no assigned putaway stops at this site, so the walk renders its empty state and no dock — ' +
        'assigning work is a write, and this suite is read-mostly',
    )

    await expectPinnedToFoot(page, 'putaway dock (page top)')
    await expectNoHorizontalOverflow(page)

    await page.evaluate(() => {
      const main = document.querySelector('main[data-scroll-container]')
      if (main) main.scrollTop = main.scrollHeight
    })
    await expectPinnedToFoot(page, 'putaway dock (page bottom)')
  })
})

test.describe('an open putaway stop fits the screen it is worked on', () => {
  test('the step scan field and the card controls are above the fold', async ({
    warehousePage: page,
  }) => {
    await navigateTo(page, 'Putaway')

    // One wrapper per stop, which is also what makes the hoist a reorder rather
    // than a remount — see PutawayWalkView. Waiting on the first is what keeps
    // the skip below honest: read too early and every run skips.
    const stops = page.locator('.queue-in > button')
    const present = await stops
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    const count = present ? await stops.count() : 0
    test.skip(
      count === 0,
      'no assigned putaway stops at this site — the walk has no card to measure, and ' +
        'assigning one is a write this read-mostly suite does not do',
    )

    // The LAST stop, not the first: the whole point of hoisting the open card is
    // that a stop partway down the run does not start below the fold. Opening
    // the first would pass even without the hoist.
    await stops.nth(count - 1).click()

    // The card's own scan field — the thing an operator aims a gun at. On the
    // RS35 a scan reaches only the FOCUSED editable, so a field below the fold
    // is a field nobody focuses and a scan that silently does nothing.
    const scan = page.getByLabel(/^Scan/).first()
    await expect(scan).toBeVisible()

    const box = await scan.boundingBox()
    expect(box, 'step scan field should be laid out').not.toBeNull()
    expect(box!.y, 'step scan field starts on screen').toBeGreaterThanOrEqual(0)
    expect(
      Math.round(box!.y + box!.height),
      'step scan field ends on screen, with no scrolling',
    ).toBeLessThanOrEqual(VIEWPORT_H)

    await expectTouchTarget(scan, 'step scan field')
    await expectNoHorizontalOverflow(page)

    // The queue-level finder stands down while a stop is open — two live scan
    // inputs is a coin toss over which one hears the gun.
    await expect(page.getByLabel(/plate, carton or bin/i)).toHaveCount(0)


  })
})
