// NX-0046: the warehouse map's correctness fixes, walked in a real browser.
//
// Each of these is here because jsdom cannot see it. The zoom reset needs a laid-out
// stage and a real fit; the role checks need the real session and the real panels;
// the load error needs a request that actually fails.
//
// READ-ONLY. Annotate is entered and a cell is painted into the WORKING SET, but
// nothing is saved: no `paint_areas`, no `set_levels`, no stock moves.
//
// SIGN-IN IS THE DEMO ROSTER on the login page, which exists on the demo host only
// (`__DEMO_HOST__`). That is the only place this suite may run, and it means the
// spec needs no credential in the environment and can never sign in to a tenant.

import { expect, type Page } from '@playwright/test'
import { test } from './fixtures/auth'

type DemoRole = 'Admin' | 'Warehouse'

async function signInOnMap(page: Page, role: DemoRole): Promise<void> {
  // `?tab=` is read once, when the shell first mounts after sign-in.
  await page.goto('/?tab=Warehouse')
  const chip = page.getByRole('button', { name: new RegExp(`Fill the form with the ${role} account`, 'i') })
  // No explicit waits anywhere in this file: `waitFor` runs to the test's own limit.
  await chip.waitFor({ state: 'visible' })
  await chip.click()
  await page.getByRole('button', { name: /^Sign in$/ }).click()
  await stageOf(page).waitFor({ state: 'visible' })
  await page.waitForTimeout(2_000) // let the first fit settle
}

const stageOf = (page: Page) => page.getByRole('application', { name: /warehouse floor plan/i })

/** The scene's zoom, read off the transform the stage actually applied. */
async function sceneScale(page: Page): Promise<number> {
  const transform = await page.evaluate(() =>
    (document.querySelector('[role="application"] svg g') as SVGGElement | null)?.getAttribute('transform') ?? '')
  const m = /scale\(([-\d.e]+)/.exec(transform)
  return m ? Number(m[1]) : NaN
}

/**
 * Wait for something slower than one action, without a per-call limit: the stock
 * query retries once with a back-off before it reports an error, which is longer
 * than a single action is allowed here. Bounded by the test's own limit.
 */
async function eventually(page: Page, done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 44; i++) {
    if (await done()) return
    await page.waitForTimeout(500)
  }
}

/** A point inside the map with no rack under it. */
async function openFloor(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const stage = document.querySelector('[role="application"]') as HTMLElement | null
    if (!stage) return null
    const r = stage.getBoundingClientRect()
    for (let i = 0; i < 600; i++) {
      const x = r.left + 40 + Math.random() * (r.width - 80)
      const y = r.top + 40 + Math.random() * (r.height - 80)
      const hit = document.elementFromPoint(x, y)
      if (hit && stage.contains(hit) && !hit.closest('[data-testid^="rack-"]') && !hit.closest('button')) return { x, y }
    }
    return null
  })
}

test.describe('warehouse map fixes (NX-0046)', () => {
  test('the zoom holds when Annotate is entered and when a cell is painted', async ({ page }) => {
    await signInOnMap(page, 'Admin')
    await stageOf(page).scrollIntoViewIfNeeded()

    const fitted = await sceneScale(page)
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.waitForTimeout(300)
    const zoomed = await sceneScale(page)
    expect(zoomed, 'zooming in must change the scale').toBeGreaterThan(fitted)

    // Entering Annotate swaps the stored areas for the working set: a new object list.
    await page.getByRole('button', { name: 'Annotate', exact: true }).click()
    await page.getByLabel('Area name').waitFor({ state: 'visible' })
    await page.waitForTimeout(400)
    expect(await sceneScale(page), 'entering Annotate must not re-fit the map').toBe(zoomed)

    // One painted cell: another new object list.
    await page.getByLabel('Area name').fill('E2E zoom check')
    const floor = await openFloor(page)
    expect(floor, 'the demo floor must have open floor visible at this zoom').not.toBeNull()
    await page.mouse.move(floor!.x, floor!.y)
    await page.mouse.down()
    await page.mouse.move(floor!.x + 3, floor!.y + 3, { steps: 3 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    await expect(stageOf(page).locator('text', { hasText: 'E2E zoom check' }).first(),
      'the stroke must have painted the working set').toBeVisible()
    expect(await sceneScale(page), 'painting a cell must not re-fit the map').toBe(zoomed)

    // Fit is still the way back to the whole floor.
    await page.getByRole('button', { name: 'Fit to view' }).click()
    await page.waitForTimeout(300)
    expect(await sceneScale(page)).not.toBe(zoomed)
  })

  test('the Warehouse role is offered nothing the server refuses', async ({ page }) => {
    await signInOnMap(page, 'Warehouse')

    // Ask the engine: no Simulate tab.
    const tabs = page.getByRole('tablist', { name: 'Questions' }).getByRole('tab')
    await expect(tabs.first()).toBeVisible()
    expect((await tabs.allInnerTexts()).map((t) => t.trim())).toEqual(['Find a product', 'Put away', 'Pick route'])

    // Location detail on a rack level: the levels are shown, nothing edits them.
    await stageOf(page).scrollIntoViewIfNeeded()
    // `rack-*` is every cell, levelled or not: a plain bin selects, a levelled
    // rack expands in place. Try cells until one expands.
    // `rack-*` is every cell, levelled or not: a plain bin selects, a levelled
    // rack expands in place. The Warehouse login lands on its home site, which is
    // large and fitted small, so most cells are clipped or a few pixels wide. The
    // click is DISPATCHED for that reason: finding a levelled rack is setup, not
    // the behaviour under test, and a dispatched click needs no hit test.
    const cells = page.locator('[data-testid^="rack-"]')
    const level = page.locator('[data-testid^="level-"]').first()
    const tries = Math.min(await cells.count(), 80)
    for (let i = 0; i < tries && (await level.count()) === 0; i++) {
      await cells.nth(i).dispatchEvent('click')
      await page.waitForTimeout(100)
    }
    expect(await level.count(), 'the demo site must have a levelled rack on the visible map').toBeGreaterThan(0)
    const levelCode = ((await level.getAttribute('data-testid')) ?? '').replace(/^level-/, '')
    await level.dispatchEvent('click')

    const panel = page.getByTestId('rack-level-panel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('select:not([disabled]), input:not([disabled])')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add level' })).toHaveCount(0)
    await expect(page.getByTestId('split-into-levels-button')).toHaveCount(0)

    // The Locations tree shows that level's fill pill, as it does for a bin.
    const row = page.locator('button', { hasText: levelCode }).filter({ hasText: /(\d+%|—)\s*$/ })
    await expect(row.first(), `the tree row for ${levelCode} must carry a fill pill`).toBeVisible()
  })

  test('a failed stock load is said above the map, with a retry', async ({ page }) => {
    let failing = true
    await page.route(/\/rest\/v1\/inventory_balances/, (route) => (failing ? route.abort() : route.continue()))
    await signInOnMap(page, 'Admin')

    const alert = page.getByTestId('warehouse-load-error')
    await eventually(page, async () => (await alert.count()) > 0)
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(/could not load/i)

    failing = false
    await alert.getByRole('button', { name: 'Try again' }).click()
    await eventually(page, async () => (await alert.count()) === 0)
    await expect(alert).toHaveCount(0)
  })
})

// A10. Its own describe because it needs WebGL and the `warehouse_3d` module,
// which is on the demo build only. Without either the toggle is never offered and
// these FAIL rather than skip: a skipped walk reads as a pass, and this spec only
// ever runs against the demo.
test.describe('warehouse 3D view falls back out loud (NX-0046)', () => {
  const toggle3d = (page: Page) => page.getByRole('button', { name: '3D', exact: true })
  // R3F puts the label on the element it is given, which may be the canvas or its
  // wrapper depending on the version, so match either and find the canvas from it.
  const canvas3d = (page: Page) => page.locator('[aria-label="3D warehouse map"]')

  test('a lost graphics context returns to 2D and says so', async ({ page }) => {
    await signInOnMap(page, 'Admin')
    await expect(toggle3d(page), '3D must be offered: demo build, desktop viewport, WebGL').toBeVisible()
    await toggle3d(page).click()
    await canvas3d(page).waitFor({ state: 'visible' })
    await page.waitForTimeout(1_000)

    // The same event a real GPU reset fires.
    await page.evaluate(() => {
      const labelled = document.querySelector('[aria-label="3D warehouse map"]') as HTMLElement
      const canvas = (labelled instanceof HTMLCanvasElement ? labelled : labelled.querySelector('canvas')) as HTMLCanvasElement
      const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    })

    await page.getByText(/lost the graphics card/i).waitFor({ state: 'visible' })
    await expect(stageOf(page)).toBeVisible()
    await expect(canvas3d(page)).toHaveCount(0)
  })

  test('3D is withdrawn when the window is no longer a desktop one', async ({ page }) => {
    await signInOnMap(page, 'Admin')
    await expect(toggle3d(page), '3D must be offered: demo build, desktop viewport, WebGL').toBeVisible()
    await toggle3d(page).click()
    await canvas3d(page).waitFor({ state: 'visible' })

    await page.setViewportSize({ width: 900, height: 800 })
    await canvas3d(page).waitFor({ state: 'detached' })
    await expect(toggle3d(page)).toHaveCount(0)
    await expect(stageOf(page)).toBeVisible()
  })
})
