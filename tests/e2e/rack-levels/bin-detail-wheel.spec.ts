// NX-0033 (C7) -- the Bin detail panel scrolls with the mouse wheel.
//
// Warehouse tab > a racked warehouse > select a bin: the Bin detail panel is capped
// at 70svh. A bin that holds more than fits used to be clipped instead of scrolled:
// the panel's scroll box (#wh-bin-detail-body) was as tall as its contents inside an
// `overflow-hidden` wrapper, so a wheel over it did nothing to the panel and went on
// to scroll the page. The Locations tree is the same FloatingPanel, so it had the
// same fault.
//
// Made-up data only (walkWorld.ts, the wheel half): one warehouse TST-WALK-WHL with one bin
// that holds 40 products, created before the browser starts and removed after.
// Setup only reads; nothing here is driven through the app but the screen under test.
import { expect, test } from '../fixtures/auth'
import { openWarehouseTab, selectWarehouseScope } from './helpers'
import {
  seedWheelWorld,
  tearDownWheelWorld,
  wheelLeftovers,
  type WheelWorld,
} from './walkWorld'

/** The panels are `max-h-[70svh]` (RackedWorkspace). */
const PANEL_CAP = 0.7

/** A wheel turn far longer than the list, so the body runs to its last row. */
const WHEEL_TO_THE_END = 10_000

let world: WheelWorld

test.describe('Warehouse panels scroll with the mouse wheel', () => {
  test.beforeAll(async () => {
    world = await seedWheelWorld()
  })

  test.afterAll(async () => {
    await tearDownWheelWorld()
    const remaining = Object.entries(await wheelLeftovers()).filter(([, n]) => n !== 0)
    expect(remaining, 'nothing the spec made may remain on dev').toEqual([])
  })

  test('the Bin detail panel scrolls with the mouse wheel', async ({ adminPage: page }) => {
    await openWarehouseTab(page)
    await selectWarehouseScope(page, `${world.warehouseName} (${world.warehouseCode})`)

    // Select the bin from the Locations tree, not the map: the tree row is a plain
    // button, and the bin is the only thing in this warehouse.
    await page.locator('#wh-tree-body').getByRole('button', { name: world.binCode }).click()

    const body = page.locator('#wh-bin-detail-body')
    const lastRow = world.productNames[world.productNames.length - 1]
    await expect(body.getByText(lastRow, { exact: true })).toBeAttached()

    // The panel (the glass card around the scroll body) is capped at 70svh, and the
    // seeded bin has to be taller than that, or there would be nothing to scroll and
    // the test would prove nothing.
    const panel = body.locator('xpath=ancestor::div[contains(@class, "glass-card")][1]')
    await panel.scrollIntoViewIfNeeded()
    const viewport = page.viewportSize()
    if (!viewport) throw new Error('the page has no viewport size')
    const panelBox = await panel.boundingBox()
    if (!panelBox) throw new Error('the Bin detail panel has no box')
    expect(
      panelBox.height,
      'the seeded bin must fill the panel up to its 70svh cap; add products to the seed if this fails',
    ).toBeGreaterThanOrEqual(viewport.height * PANEL_CAP - 4)

    // The mouse goes over the middle of the panel's visible box, not the middle of
    // the scroll body: before the fix that body was thousands of pixels tall and its
    // centre was clipped away.
    await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2)
    await page.mouse.wheel(0, 400)

    // The scroll body is what moves. Polled, because the wheel is smoothed.
    await expect
      .poll(() => body.evaluate((el) => el.scrollTop), { message: 'the Bin detail body scrolled' })
      .toBeGreaterThan(0)

    // And it reaches the end of the list, so the last product is reachable.
    await page.mouse.wheel(0, WHEEL_TO_THE_END)
    await expect
      .poll(() => body.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop), {
        message: 'the Bin detail body scrolled to its last row',
      })
      .toBeLessThanOrEqual(1)
  })
})
