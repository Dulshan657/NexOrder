// NX-0049 -- one product per location at putaway, and the switch to ignore
// capacity, on dev, in a browser, with the made-up world of homeBlockWorld.ts
// (warehouse TST-HOME-E2E, bins H, X, Y, Z, products TST-HOME-200 and
// TST-HOME-300). No home is set in this story: it is about locations that
// already hold another product.
//
// DRIVEN THROUGH THE SCREENS
//   - receive TST-HOME-300 and put it away on the Walk into the engine's bin B;
//   - receive TST-HOME-200: the planner does not offer B. On the Walk, scanning
//     B is refused AT THE SCAN ("B already holds TST-HOME-300 ...") and the card
//     stays on the location step; scanning its own bin completes;
//   - Replenishment > Min/max setup: an Admin switches "Ignore location
//     capacity" on, sees it saved after a reload, and switches it back off,
//     leaving dev's site-wide setting as it was found.
//
// READ FROM THE DATABASE
//   - the tasks' bins, and stock on hand, so "refused" is shown to move nothing.
import type { Page, TestInfo } from '@playwright/test'
import { expect, test } from '../fixtures/auth'
import { openPutawayQueue, selectPutawayWarehouse } from './helpers'
import {
  binField,
  confirmCount,
  openMinMaxSetup,
  openWalkStop,
  receiveCartons,
  scanBin,
} from './homeBlockSteps'
import {
  CARTON_SIZE,
  leftovers,
  onHandAt,
  seedWorld,
  snapshotWorld,
  tasksOf,
  tearDownWorld,
  type TaskRow,
  type World,
} from './homeBlockWorld'

const CARTONS = 2
const LINE_UNITS = CARTONS * CARTON_SIZE

let world: World

test.use({ trace: 'on', screenshot: 'on' })

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function newestTask(productId: number): Promise<TaskRow> {
  const tasks = await tasksOf(productId)
  const last = tasks[tasks.length - 1]
  if (!last) throw new Error(`no putaway task for product ${productId}`)
  return last
}

function codeOf(id: number | null): string {
  const bin = Object.values(world.bins).find((b) => b.id === id)
  if (!bin) throw new Error(`task bin ${id} is not one of the world's bins`)
  return bin.code
}

const capacitySwitch = (page: Page) =>
  page.getByRole('checkbox', { name: 'Ignore location capacity (treat space as unlimited)' })

test.describe('One product per location at putaway', () => {
  test.beforeAll(async () => {
    world = await seedWorld()
  })

  test.afterAll(async () => {
    const ids = await snapshotWorld()
    await tearDownWorld()
    const remaining = Object.entries(await leftovers(ids)).filter(([, n]) => n !== 0)
    expect(remaining, 'nothing the spec made may remain on dev').toEqual([])
  })

  test('a location holding another product is refused at the scan', async ({ adminPage: page }, testInfo) => {
    test.setTimeout(240_000)
    let b = ''
    let bId = 0

    await test.step('1. TST-HOME-300 is received and put away in the engine bin B', async () => {
      await receiveCartons(page, world, world.other, CARTONS)
      const task = await newestTask(world.other.id)
      expect(task).toMatchObject({ status: 'assigned', suggestionSource: 'engine' })
      bId = task.recommendedLocationId!
      b = codeOf(bId)
      await openPutawayQueue(page)
      await selectPutawayWarehouse(page, world.warehouseCode)
      await openWalkStop(page, world.other, b)
      await scanBin(page, b)
      await confirmCount(page)
      await expect(page.getByText(`Placed in ${b}`)).toBeVisible()
      expect(await onHandAt(world.other.id, bId)).toBe(LINE_UNITS)
    })

    await test.step('2. TST-HOME-200 is received: the planner does not offer B', async () => {
      await receiveCartons(page, world, world.home, CARTONS)
      const task = await newestTask(world.home.id)
      expect(task.status).toBe('assigned')
      expect(task.recommendedLocationId).not.toBeNull()
      expect(task.recommendedLocationId).not.toBe(bId)
    })

    await test.step('3. On the Walk, scanning B is refused at the scan; the card stays on the location step', async () => {
      const task = await newestTask(world.home.id)
      const own = codeOf(task.recommendedLocationId)
      await openPutawayQueue(page)
      await selectPutawayWarehouse(page, world.warehouseCode)
      await openWalkStop(page, world.home, own)
      await scanBin(page, b)
      await expect(page.getByRole('alert').filter({ hasText: `${b} already holds ${world.other.sku}` })).toBeVisible()
      await expect(binField(page)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0)
      await shot(page, testInfo, '3-refused-at-the-scan')
      expect((await newestTask(world.home.id)).status).toBe('assigned')
      expect(await onHandAt(world.home.id, bId)).toBe(0)

      await scanBin(page, own)
      await confirmCount(page)
      await expect(page.getByText(`Placed in ${own}`)).toBeVisible()
      await shot(page, testInfo, '3b-placed-in-its-own-location')
      expect(await onHandAt(world.home.id, task.recommendedLocationId!)).toBe(LINE_UNITS)
    })

    await test.step('4. An Admin switches "Ignore location capacity" on, it stays on after a reload, then off again', async () => {
      await openMinMaxSetup(page, world)
      const toggle = capacitySwitch(page)
      await expect(toggle).toBeEnabled()
      const before = await toggle.isChecked()
      try {
        await toggle.click()
        await expect(page.getByText(before
          ? 'Location capacity is enforced again'
          : 'Location capacity is now ignored at putaway')).toBeVisible()
        await shot(page, testInfo, '4-capacity-switch')
        await page.reload()
        await openMinMaxSetup(page, world)
        await expect(capacitySwitch(page)).toBeChecked({ checked: !before })
      } finally {
        // Leave dev's site-wide setting as it was found.
        if ((await capacitySwitch(page).isChecked()) !== before) {
          await capacitySwitch(page).click()
          await expect(capacitySwitch(page)).toBeChecked({ checked: before })
        }
      }
    })
  })
})
