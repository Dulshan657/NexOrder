// Guards F25: Receive Stock's line table was ~1100 px of fixed columns with no
// card layout at any width, so on the RS35 the receipt was three screens wide
// and the batch-barcode box and the Hold checkbox were off to the right.
//
// The fix is one render with a CSS grid template that swaps at `xl`, using
// `display: contents` above the breakpoint. That is exactly the kind of thing a
// later layout change breaks silently, because it still looks right on the
// desktop the change was made on.
//
// Adding a line is client-side state only — nothing is written until Receive is
// pressed, which this spec never does. Read-mostly, per tests/e2e/README.md.
import { expect, test } from '../fixtures/auth'
import { expectNoHorizontalOverflow, expectTouchTarget, navigateTo } from './helpers'

const VIEWPORT_W = 360

test.describe('F25 — Receive Stock fits a 360 px screen', () => {
  test('an empty receipt does not scroll sideways', async ({ warehousePage: page }) => {
    await navigateTo(page, 'Receive Stock')
    await expect(page.getByRole('heading', { name: 'Receive Stock' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('a receipt line collapses to a card, with the barcode and Hold reachable', async ({
    warehousePage: page,
  }) => {
    await navigateTo(page, 'Receive Stock')

    // One box does both jobs here: typing searches, a scan adds outright.
    // A single letter is enough to raise the dropdown on any seeded catalogue.
    await page.getByLabel('Search products').fill('a')

    const firstMatch = page.locator('.absolute button').first()
    await expect(firstMatch).toBeVisible({ timeout: 10_000 })
    await firstMatch.click()

    // The line's own controls, each of which used to sit off-screen right.
    // Matched by the aria-labels ReceiveLineCard sets per line, so this cannot
    // accidentally assert against the receipt-level barcode or Quarantine
    // controls in the header card above.
    const barcode = page.getByLabel(/^Batch barcode for line /).first()
    const hold = page.getByLabel(/^Quarantine line /).first()

    await expect(hold).toBeVisible()
    await expect(barcode).toBeVisible()

    // In the viewport, not merely in the DOM — the defect was horizontal, so
    // "rendered" was never the question.
    for (const [control, label] of [[hold, 'Hold checkbox'], [barcode, 'batch barcode']] as const) {
      const box = await control.boundingBox()
      expect(box, `${label} should be laid out`).not.toBeNull()
      expect(box!.x, `${label} starts inside the viewport`).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width, `${label} ends inside the viewport`).toBeLessThanOrEqual(VIEWPORT_W)
    }

    // F25's tail: the batch barcode is a ScanField and must NOT be the
    // `compact` variant, which drops the touch floor on a scanning surface.
    await expectTouchTarget(barcode, 'batch barcode field')

    await expectNoHorizontalOverflow(page)
  })
})
