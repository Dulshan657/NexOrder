// Shared helpers for the 360 px suite.
//
// These specs exist because the register (KNOWN-ERRORS-REGISTER.md, O7) had no
// small-screen coverage at all: the only Playwright project was Desktop Chrome,
// so every fix logged at 360 px — F8, F15, F16, F17, F24, F25 — could regress
// with nothing to catch it. Each spec here names the row it guards, so a
// failure points at what it was for rather than just at a number.
//
// They run as the WAREHOUSE role. The width is only half the subject; the other
// half is what the person holding the handheld can actually reach and press.
import { expect, type Locator, type Page } from '@playwright/test'

/** The 44 px floor. Not a style preference — F15/F16 are both this number, and
 *  it is what a gloved thumb needs at a rack face. */
export const MIN_TOUCH_PX = 44

/**
 * Navigate via the real sidebar, which on this width means opening it first.
 *
 * Deliberately NOT `?tab=`, but NOT for the reason this comment used to give.
 * It claimed the deep-link read branch sits *after* the Warehouse-role early
 * return and so does nothing for this role. That is false: `adminTabFromSearch`
 * is the FIRST statement in AppShell's `adminView` initialiser, and
 * `TABS_BY_ROLE.Warehouse` is populated, so `?tab=Putaway` works fine here.
 *
 * The real reason is the one the old comment listed second: driving the ☰ is the
 * only thing that proves the ☰ — and now the mobile top bar that owns it, and
 * the drawer it opens — actually works.
 */
export async function navigateTo(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click()
  // NOT `exact: true`. Putaway and Replenishment render a pending-count badge
  // inside the button, so their accessible names are "Putaway 44" and
  // "Replenishment 1" — and the count is live data, so it cannot be written
  // into the matcher either. Anchored at the start so "Stock" cannot match
  // "Stocktake".
  await page.getByRole('button', { name: new RegExp(`^${item}(\\s+\\d+)?$`) }).click()
  // The sidebar closes itself on selection (setIsSidebarOpen(false)); waiting
  // for that rather than for the destination keeps this helper generic.
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
}

/**
 * The page body must never scroll sideways.
 *
 * Measured on the two elements that can: `document.documentElement`, and
 * `main[data-scroll-container]`, which is the app's real vertical scroller
 * (the shell root is `h-screen overflow-hidden`, so the body never scrolls —
 * see CLAUDE.md). An inner `overflow-x-auto` container is allowed to scroll and
 * is deliberately not measured; that is the sanctioned way to carry a wide
 * table, and the defect F25 recorded was the *page* moving, not a table.
 *
 * 1 px of tolerance for subpixel layout rounding; the failure this catches was
 * 3× the screen wide.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    const main = document.querySelector('main[data-scroll-container]')
    return {
      document: doc.scrollWidth - doc.clientWidth,
      scroller: main ? main.scrollWidth - main.clientWidth : 0,
    }
  })
  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.scroller).toBeLessThanOrEqual(1)
}

/** Every element the operator is meant to press clears the touch floor. */
export async function expectTouchTarget(target: Locator, label: string): Promise<void> {
  const box = await target.boundingBox()
  expect(box, `${label} should be laid out`).not.toBeNull()
  expect(Math.round(box!.height), `${label} height`).toBeGreaterThanOrEqual(MIN_TOUCH_PX)
}

/** True when the two boxes overlap at all. Used for the ☰-over-the-controls
 *  defect (F8), where "visible" was never the problem — reachable was. */
export async function overlaps(a: Locator, b: Locator): Promise<boolean> {
  const [boxA, boxB] = await Promise.all([a.boundingBox(), b.boundingBox()])
  if (!boxA || !boxB) return false
  return (
    boxA.x < boxB.x + boxB.width &&
    boxB.x < boxA.x + boxA.width &&
    boxA.y < boxB.y + boxB.height &&
    boxB.y < boxA.y + boxA.height
  )
}

/** The site picker on the four inventory pages. Labelled, not positional. */
export function warehouseSelect(page: Page): Locator {
  return page.getByLabel('Warehouse').first()
}

/** Pixel 5, per playwright.config.ts. A dock's bottom edge must land here. */
export const VIEWPORT_H = 664

/** The scan dock itself, not the field inside it — they differ by the dock's
 *  `py-2`, and 8px of difference is exactly the size of the defect being
 *  guarded. */
export function scanDock(page: Page): Locator {
  return page.locator('[data-scan-dock="bottom"]')
}

/**
 * Flush with the foot of the screen, within a px or two of subpixel rounding.
 *
 * Lifted out of `scan-dock.spec.ts` when a third surface (the Stock lookup)
 * grew a dock: one assertion the docks share cannot disagree with itself, which
 * two copies eventually would. The spec's own header stays where it is — it
 * explains the SPEC, not this helper.
 */
export async function expectPinnedToFoot(page: Page, label: string): Promise<void> {
  const box = await scanDock(page).boundingBox()
  expect(box, `${label} should be laid out`).not.toBeNull()
  const foot = Math.round(box!.y + box!.height)
  expect(foot, `${label} reaches the foot of the screen`).toBeGreaterThanOrEqual(VIEWPORT_H - 2)
  expect(foot, `${label} is not below the fold`).toBeLessThanOrEqual(VIEWPORT_H + 2)
}
