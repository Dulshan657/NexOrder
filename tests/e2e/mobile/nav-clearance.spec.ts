// Guards F8, and now F40: the mobile ☰ sat on top of the page heading.
//
// ORIGINAL DEFECT (F8). The ☰ was `fixed top-4 left-4 z-30 md:hidden` and floated
// over the page. Only four of the ten Warehouse screens reserved space for it
// (`pl-16 … md:pl-6`, and `pl-12 md:pl-0` on Receive Stock) — four independent
// edits, therefore four independent things to lose, and on the other six the
// heading sat underneath a button. This spec asserted OVERLAP rather than
// visibility, because the control was always visible; it was underneath
// something, which is a different failure and the one that cost the operator the
// page.
//
// WHAT CHANGED (F40). The ☰ now lives in `components/MobileTopBar.tsx`, a flow
// -positioned flex sibling of `main[data-scroll-container]`. Overlap is no longer
// something the pages avoid — it is structurally impossible, and the four
// clearances have been deleted. So the overlap assertion is now trivially true
// and worth almost nothing on its own.
//
// The value moved to three things it can still fail on, across all TEN tabs
// rather than four:
//   1. the bar is in FLOW (make it `position: fixed` again and #2 fails);
//   2. no page has re-grown a dead gutter where the ☰ used to be;
//   3. the bar's title agrees with the sidebar item that navigated to it —
//      which is the live guard on ADMIN_TAB_LABELS, whose one non-identity
//      entry is `'Receiving'` -> "Receive Stock".
import { expect, test } from '../fixtures/auth'
import { expectNoHorizontalOverflow, expectTouchTarget, navigateTo, overlaps } from './helpers'

/**
 * Every tab a Warehouse login can reach, by its sidebar label.
 *
 * Ten, not the nine CLAUDE.md listed until 2026-08-26 — `Off-home` was missing
 * there. All ten are `inventory_dispatch`, so Amadiya's module set leaves the
 * role complete and every one of these is a screen a real operator opens.
 *
 * `Stock` and `Stocktake` both appear; `navigateTo` anchors its matcher, so
 * `^Stock$` cannot match `Stocktake`.
 */
const WAREHOUSE_TABS: ReadonlyArray<string> = [
  'Pick Queue',
  'Dispatched',
  'Receive Stock',
  'Putaway',
  'Replenishment',
  'Off-home',
  'Stocktake',
  'Stock',
  'Documents',
  'Warehouse',
]

/** Where a page's own content starts. The ☰ used to occupy 16→52px. */
const DEAD_GUTTER_LIMIT_PX = 24

test.describe('F8/F40 — the mobile top bar owns the ☰', () => {
  for (const item of WAREHOUSE_TABS) {
    test(`${item}: top bar is in flow, titled, and leaves no gutter`, async ({ warehousePage: page }) => {
      await navigateTo(page, item)

      const bar = page.locator('header[data-mobile-topbar]')
      await expect(bar).toBeVisible()

      const menu = page.getByRole('button', { name: 'Open menu' })
      await expectTouchTarget(menu, `${item}: the ☰`)

      // The title is the bar's own text, not a heading — every page still
      // renders its own <h1>, and a second one would break the heading
      // selectors these specs use elsewhere.
      await expect(bar).toContainText(item)

      const heading = page.getByRole('heading').first()
      await expect(heading).toBeVisible()

      // (1) IN FLOW. A `position: fixed` bar would paint over the heading; a
      // flow sibling cannot. This is the assertion that fails if anyone
      // "simplifies" MobileTopBar back to fixed positioning.
      expect(
        await overlaps(bar, heading),
        `the top bar overlaps the page heading on ${item} — is it position:fixed again?`,
      ).toBe(false)

      const barBox = await bar.boundingBox()
      const headingBox = await heading.boundingBox()
      expect(barBox!.y + barBox!.height, `${item}: content must start below the bar`)
        .toBeLessThanOrEqual(headingBox!.y + 1)

      // (2) NO DEAD GUTTER. This is what catches a `pl-16` being re-added: with
      // the ☰ gone from the page, 64px of left padding is 18% of a 360px screen
      // spent on nothing.
      expect(Math.round(headingBox!.x), `${item}: page content starts too far right — a stale ☰ clearance?`)
        .toBeLessThan(DEAD_GUTTER_LIMIT_PX)

      await expectNoHorizontalOverflow(page)
    })
  }
})

test.describe('F37 — the bell is reachable without opening the drawer', () => {
  test('the notification panel opens from the top bar and stays on screen', async ({ warehousePage: page }) => {
    await navigateTo(page, 'Pick Queue')

    const bar = page.locator('header[data-mobile-topbar]')
    const bell = bar.getByRole('button', { name: /Notifications/ })
    // Reachable in ONE tap. It used to live in the sidebar header, i.e. behind
    // the ☰, on a screen where the sidebar is off-canvas.
    await expect(bell).toBeVisible()
    await expectTouchTarget(bell, 'the notification bell')

    await bell.click()

    const panel = page.getByRole('heading', { name: 'Notifications' })
    await expect(panel).toBeVisible()

    // The whole panel, not just its heading, must be inside the viewport. The
    // old one ran ~48px off the right on a 360px screen while a
    // `max-w-[calc(100vw-1.5rem)]` that computed to 336px against a 288px panel
    // looked like it was preventing exactly that.
    const box = await panel.locator('xpath=ancestor::div[1]').boundingBox()
    const viewport = page.viewportSize()!
    expect(box!.x, 'panel left edge is off screen').toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, 'panel right edge is off screen').toBeLessThanOrEqual(viewport.width + 1)
    expect(box!.y + box!.height, 'panel bottom is below the fold').toBeLessThanOrEqual(viewport.height + 1)

    // Portalling the panel moved it out of the trigger's ref, which is what
    // made every click INSIDE it read as an outside click. Clicking a heading
    // inside the panel must not dismiss it.
    await panel.click()
    await expect(panel).toBeVisible()
  })
})
