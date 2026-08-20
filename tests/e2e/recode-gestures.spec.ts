// The recode sweep's gestures, verified in a real browser.
//
// These are here because none of them can be caught anywhere else. The text-selection
// smear is a browser default doing something the app never asked for; the paint/pan
// arbitration is decided from a hit test against real laid-out geometry; and
// `setPointerCapture` is the mechanism the whole gesture layer rests on. A unit test
// sees none of it — mapGesture.test.ts pins the DECISION and is deliberately blind to
// whether the decision is ever reached.
//
// EVERY COORDINATE IS DERIVED FROM THE DOM, never from a fraction of the map's box.
// The first draft of this file dragged across the middle of the stage and asserted
// something had been selected; it failed on the demo site, whose forty racks are
// sparse and partly scrolled out of view, and the failure looked exactly like a
// broken hit test. Ask the page where the racks actually are.
//
// Read-only: every check paints a selection and then leaves. Nothing calls
// `recode_locations`, so no code is ever written.

import { expect, type Page } from '@playwright/test'
import { test } from './fixtures/auth'

interface Point { x: number; y: number }

/** Rack centres that are actually inside the visible map, in draw order. */
async function rackCentres(page: Page): Promise<Array<Point & { id: string }>> {
  return page.evaluate(() => {
    const stage = document.querySelector('[role="application"]') as HTMLElement | null
    if (!stage) return []
    const s = stage.getBoundingClientRect()
    const out: Array<{ id: string; x: number; y: number }> = []
    for (const g of document.querySelectorAll('[data-testid^="rack-"]')) {
      const r = g.getBoundingClientRect()
      const x = r.x + r.width / 2
      const y = r.y + r.height / 2
      // Clipped racks are unclickable; a drag aimed at one lands on nothing.
      if (x > s.left + 4 && x < s.right - 4 && y > s.top + 4 && y < s.bottom - 4) {
        out.push({ id: g.getAttribute('data-testid') ?? '', x, y })
      }
    }
    return out
  })
}

/** A point inside the map with no bin under it. */
async function openFloor(page: Page): Promise<Point | null> {
  return page.evaluate(() => {
    const stage = document.querySelector('[role="application"]') as HTMLElement | null
    if (!stage) return null
    const r = stage.getBoundingClientRect()
    for (let i = 0; i < 600; i++) {
      const x = r.left + 12 + Math.random() * (r.width - 24)
      const y = r.top + 12 + Math.random() * (r.height - 24)
      const hit = document.elementFromPoint(x, y)
      if (hit && stage.contains(hit) && !hit.closest('[data-testid^="rack-"]')) return { x, y }
    }
    return null
  })
}

/** Drag with TRUSTED pointer events. `page.mouse` is what setPointerCapture needs —
 *  a synthetic pointerId is silently not capturable and the stroke does nothing. */
async function drag(page: Page, from: Point, to: Point, opts: { button?: 'left' | 'right'; steps?: number } = {}) {
  const { button = 'left', steps = 20 } = opts
  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button })
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up({ button })
  await page.waitForTimeout(150)
}

const panelOf = (page: Page) => page.locator('aside[aria-label="Recode bins"]')

/** The panel's own count — the app's answer to "what did that drag mean". */
async function selectedCount(page: Page): Promise<number> {
  const text = await panelOf(page).innerText()
  return Number(/(\d+)\s*\n?\s*bins? selected/.exec(text)?.[1] ?? NaN)
}

async function sceneTransform(page: Page): Promise<string | null> {
  return page.evaluate(() =>
    (document.querySelector('[role="application"] svg g') as SVGGElement | null)?.getAttribute('transform') ?? null)
}

test.describe('recode sweep gestures', () => {
  let racks: Array<Point & { id: string }> = []

  test.beforeEach(async ({ adminPage: page }) => {
    await page.goto('/?tab=Warehouse')
    const stage = page.getByRole('application', { name: /warehouse floor plan/i })
    await stage.waitFor({ state: 'visible', timeout: 25_000 })
    await page.waitForTimeout(2_000) // let the layout finish fitting
    await page.getByRole('button', { name: 'Recode bins' }).click()
    await expect(panelOf(page)).toBeVisible()
    await stage.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    racks = await rackCentres(page)
    test.skip(racks.length < 2, 'this site has fewer than two visible racks')
  })

  // THE REPORTED BUG. Native selection is a document-order range, so before the fix
  // a drag smeared a contiguous run of SVG <text> nodes — bin codes, area names —
  // from the anchor to the pointer, which read as the brush selecting bins it had
  // never touched.
  test('a drag never extends a native text selection across the map', async ({ adminPage: page }) => {
    await drag(page, racks[0], racks[racks.length - 1], { steps: 30 })
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? ''),
      'a drag on the map must select no text at all').toBe('')

    // The harder half, and the reason `select-none` alone is not enough: an anchor
    // that already exists OUTSIDE the map still extends INTO an unselectable subtree.
    // The panel is a grid sibling, so this is a reachable sequence, not a contrivance.
    //
    // The property is that the drag does not GROW the selection. The existing one
    // staying exactly as it was is correct — preventing a new selection is the job,
    // not clearing somebody else's.
    await page.evaluate(() => {
      const el = document.querySelector('aside[aria-label="Recode bins"] h2')
      if (!el) return
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
    const before = await page.evaluate(() => window.getSelection()?.toString() ?? '')
    expect(before).toBe('Recode bins')

    await drag(page, racks[0], racks[racks.length - 1], { steps: 30 })

    expect(await page.evaluate(() => window.getSelection()?.toString() ?? ''),
      'the drag must not extend the panel selection into the map').toBe(before)
  })

  // The headline rule, from both sides.
  test('painting over storage selects; dragging open floor moves the map', async ({ adminPage: page }) => {
    await drag(page, racks[0], { x: racks[0].x + 3, y: racks[0].y + 3 }, { steps: 3 })
    const painted = await selectedCount(page)
    expect(painted, 'a stroke on a rack must select it').toBeGreaterThan(0)

    const floor = await openFloor(page)
    test.skip(!floor, 'no open floor visible at this zoom')

    const before = await sceneTransform(page)
    await drag(page, floor!, { x: floor!.x + 90, y: floor!.y + 60 })

    expect(await sceneTransform(page), 'dragging open floor must pan the map').not.toBe(before)
    expect(await selectedCount(page), 'panning must not change the selection').toBe(painted)
  })

  // Accumulation is the property the smear was hiding. Two separate strokes union;
  // a third, right-dragged, subtracts — without flipping the toolbar's armed mode.
  test('separate strokes accumulate, and a right-drag subtracts', async ({ adminPage: page }) => {
    await drag(page, racks[0], { x: racks[0].x + 3, y: racks[0].y + 3 }, { steps: 3 })
    const first = await selectedCount(page)
    expect(first).toBeGreaterThan(0)

    const other = racks[racks.length - 1]
    await drag(page, other, { x: other.x + 3, y: other.y + 3 }, { steps: 3 })
    const second = await selectedCount(page)
    expect(second, 'a second stroke must ADD, never replace').toBeGreaterThan(first)

    await drag(page, racks[0], { x: racks[0].x + 3, y: racks[0].y + 3 }, { button: 'right', steps: 3 })
    expect(await selectedCount(page), 'right-drag must subtract').toBeLessThan(second)

    // And it must NOT have armed Erase — that would strand the tool after a cancel.
    await expect(panelOf(page).getByRole('button', { name: 'Erase' }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  test('Ctrl+Z undoes one stroke and leaves panel inputs alone', async ({ adminPage: page }) => {
    await drag(page, racks[0], { x: racks[0].x + 3, y: racks[0].y + 3 }, { steps: 3 })
    const first = await selectedCount(page)
    const other = racks[racks.length - 1]
    await drag(page, other, { x: other.x + 3, y: other.y + 3 }, { steps: 3 })
    expect(await selectedCount(page)).toBeGreaterThan(first)

    await page.keyboard.press('Control+z')
    expect(await selectedCount(page), 'one Ctrl+Z takes back exactly one stroke').toBe(first)

    // The panel is a grid SIBLING of the map, so React events from its inputs never
    // reach the map's handler — which is what lets native undo keep working there
    // with no isEditable sniffing. Verify both halves of that.
    const panel = panelOf(page)
    await panel.getByRole('button', { name: /Step 2, Block/ }).click()
    const input = panel.locator('input[placeholder="BULK"]')
    await input.click()
    await input.pressSequentially('COLDSTORE', { delay: 20 })
    await page.keyboard.press('Control+z')
    await expect(input, 'Ctrl+Z in an input must undo TEXT').not.toHaveValue('COLDSTORE')

    await panel.getByRole('button', { name: /Step 1, Select/ }).click()
    expect(await selectedCount(page), 'and must not touch the selection').toBe(first)
  })

  // Apply's own comment has always promised this; until now the button was disabled
  // on every step but Review, so the branch could not fire.
  test('Apply navigates to Review from step 1 instead of sitting grey', async ({ adminPage: page }) => {
    const panel = panelOf(page)
    await drag(page, racks[0], { x: racks[0].x + 3, y: racks[0].y + 3 }, { steps: 3 })
    expect(await selectedCount(page)).toBeGreaterThan(0)

    await panel.getByRole('button', { name: /Step 2, Block/ }).click()
    await panel.locator('input[placeholder="BULK"]').fill('E2ETEST')
    await panel.getByRole('button', { name: /Step 1, Select/ }).click()

    // By test id, not by name: the signpost above it is ALSO a button and also says
    // "Review the sweep first", which is the point of it — the reason is a
    // destination, not decoration — so a name match is ambiguous by design.
    const apply = panel.getByTestId('recode-apply')
    await expect(apply, 'Apply must be pressable when the blocker is elsewhere').toBeEnabled()
    await expect(apply).toHaveText('Review')

    // The signpost is a BUTTON, not decoration — the reason names a destination, and
    // being able to press it is the whole point. Asserted here rather than clicked,
    // because it only exists while there is no preview: the moment Review has been
    // visited the blocker is gone and so is this. (Clicking it after that round trip
    // was the assertion that failed while writing this, which is the same fact.)
    await expect(panel.getByRole('button', { name: /Review the sweep first/ }))
      .toBeEnabled()

    await apply.click()
    await expect(panel.getByRole('button', { name: /Step 4, Review/ }))
      .toHaveAttribute('aria-current', 'step')
  })

  // Step 4 with nothing selected used to shimmer forever: the preview effect
  // early-returns without ever setting `loading`, so `loading || !preview` was true
  // and stayed true, behind an aria-busy region and a toast that had already gone.
  test('Review with nothing selected shows an empty state, not a forever skeleton', async ({ adminPage: page }) => {
    const panel = panelOf(page)
    await panel.getByRole('button', { name: /Step 4, Review/ }).click()

    await expect(panel.getByText('Nothing to check yet')).toBeVisible({ timeout: 5_000 })
    await expect(panel.getByText(/Paint some bins on the map first/)).toBeVisible()
    await expect(panel.locator('[aria-busy="true"]')).toHaveCount(0)
  })
})
