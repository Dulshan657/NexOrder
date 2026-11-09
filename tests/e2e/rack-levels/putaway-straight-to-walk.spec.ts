// NX-0033 -- a received line goes straight onto the Walk.
//
// One story, on dev, in a browser, with made-up data this spec creates and
// removes (walkWorld.ts): a warehouse TST-WALK-E2E with seven pick bins (H, O1,
// O2, N1..N3 and an inactive I), a published layout with a dock route, a product
// TST-WALK-200 homed at H, four products with no home (TST-WALK-301..304) and a
// Warehouse-role user homed at the warehouse.
//
// DRIVEN THROUGH THE SCREENS
//   - receive cartons on Receive Stock (carton plates: a pallet is a unit load);
//   - the Assign tab (is the line there? "Home full"; the desk's Assign);
//   - the Walk tab: the stop, its badge and heading, the scans, the count;
//   - "Give it a home": by scanning, by typing and by the dropdown;
//   - signing in as a Warehouse user, who is shown no offer.
//   The "Manager" in the spec's story is the seeded Admin login: the fixtures
//   have only Admin and Warehouse logins. The Manager role is proved by the HTTP
//   integration test, with a made-up Manager user.
//
// READ FROM THE DATABASE
//   - each task's status, bin and assigned_by, and its suggestion source: no
//     screen shows who assigned a line or where its bin came from;
//   - stock on hand and the product's home, so "placed" and "refused" are shown
//     to have moved what they say, and nothing else.
//
// SEEDED, NOT DRIVEN
//   - the world;
//   - the maximum at H (setHomeMax): NX-0032 proves the screen that sets it;
//   - the forged request that a Warehouse user could not send from a screen:
//     complete-putaway with make_home, posted with that user's own session.
//
// Each test is a part of the story and leans on the ones before it (serial). The
// whole story is slow because it drives a receipt through the screens before
// every putaway; each test sets a story-length timeout, as putaway-home-block
// does, and no assertion has a longer one than the suite's.
import type { Page } from '@playwright/test'
import { expect, loginAs, test } from '../fixtures/auth'
import {
  assignInQueue,
  callFunction,
  confirmCount,
  openWalkStop,
  receiveCartons,
  scanBin,
} from './homeBlockSteps'
import {
  COPY,
  binCodeOf,
  binScanField,
  chooseHome,
  identifyField,
  identifyProduct,
  openGiveHome,
  openPutawayStage,
  openStopCard,
  queueRow,
  scanBinAs,
  shot,
  walkStop,
  type HomeMethod,
} from './walkSteps'
import {
  CARTON_SIZE,
  homeOf,
  leftovers,
  onHandAnywhere,
  onHandAt,
  seedWorld,
  setHomeMax,
  snapshotWorld,
  tasksOf,
  tearDownWorld,
  type TaskRow,
  type WalkWorld,
  type WorldBin,
  type WorldProduct,
} from './walkWorld'

const STORY_TIMEOUT = 240_000 // several screens a part; the 30 s default is for a single screen
const CARTONS = 4
const LINE_UNITS = CARTONS * CARTON_SIZE
const SMALL_CARTONS = 2
const SMALL_UNITS = SMALL_CARTONS * CARTON_SIZE

let world: WalkWorld

test.use({ trace: 'on', screenshot: 'on' })

async function newestTask(productId: number): Promise<TaskRow> {
  const tasks = await tasksOf(productId)
  const last = tasks[tasks.length - 1]
  if (!last) throw new Error(`no putaway task for product ${productId}`)
  return last
}

/** The Walk tab, the stop open and the product scanned: the card waits on the bin. */
async function openOverflowStopAtBin(page: Page, product: WorldProduct, bin: WorldBin): Promise<void> {
  await openPutawayStage(page, world, 'Walk')
  await openStopCard(page, product, bin.code)
  await identifyProduct(page, product)
  await expect(binScanField(page, COPY.confirmScanLabel(bin.code))).toBeVisible()
}

test.describe.serial('Putaway goes straight onto the walk', () => {
  test.beforeAll(async () => {
    world = await seedWorld()
  })

  test.afterAll(async () => {
    // The ids are taken from the database before the teardown, so the counts
    // afterwards look for rows that still point at what was removed.
    const ids = await snapshotWorld()
    if (world) expect(ids.warehouseId, 'the world was there to remove').toBe(world.warehouseId)
    // What the run left on dev for the teardown to remove, for the run's log.
    console.log('before teardown:', JSON.stringify(await leftovers(ids)))
    await tearDownWorld()
    const left = await leftovers(ids)
    const remaining = Object.entries(left).filter(([, n]) => n !== 0)
    expect(remaining, 'nothing the spec made may remain on dev').toEqual([])
  })

  test('1. a homed product is on the walk, not the Assign queue, and is put away there', async ({ adminPage: page }, testInfo) => {
    test.setTimeout(STORY_TIMEOUT)
    const { h } = world.bins
    const product = world.homed

    await test.step('receive 4 cartons: one task, assigned to H by the system', async () => {
      await receiveCartons(page, world, product, CARTONS)
      const tasks = await tasksOf(product.id)
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toMatchObject({
        status: 'assigned', quantity: LINE_UNITS, recommendedLocationId: h.id, assignedLocationId: h.id,
        assignedBy: null, suggestionSource: 'home',
      })
    })

    await test.step('the Assign tab has no row for it', async () => {
      await openPutawayStage(page, world, 'Assign')
      // The queue has loaded when it says it is empty: this warehouse holds nothing else.
      await expect(page.getByText(COPY.assignQueueEmpty)).toBeVisible()
      await expect(queueRow(page, product)).toHaveCount(0)
      await shot(page, testInfo, '1a-assign-tab-empty')
    })

    await test.step('the Walk tab has a stop at H; scan the product, scan H, confirm the count', async () => {
      await openPutawayStage(page, world, 'Walk')
      await expect(walkStop(page, product, h.code)).toBeVisible()
      await openWalkStop(page, product, h.code)
      await shot(page, testInfo, '1b-walk-stop-open')
      await scanBin(page, h.code)
      await confirmCount(page)
      await expect(page.getByText(`Placed in ${h.code}`)).toBeVisible()
      await shot(page, testInfo, '1c-placed-in-the-home')
      expect(await onHandAt(product.id, h.id)).toBe(LINE_UNITS)
      expect((await newestTask(product.id)).status).toBe('accepted')
    })
  })

  test('2. home full: the overflow line shows on both lists, and the walk confirms it', async ({ adminPage: page }, testInfo) => {
    test.setTimeout(STORY_TIMEOUT)
    const { o1, o2 } = world.bins
    const product = world.homed

    await test.step('H is at its maximum; receive 2 cartons: a suggested overflow task for O1', async () => {
      await setHomeMax(world, product.id, await onHandAt(product.id, world.bins.h.id))
      expect(await homeOf(world, product.id)).toEqual({ binId: world.bins.h.id, maxQty: LINE_UNITS })
      await receiveCartons(page, world, product, SMALL_CARTONS)
      expect(await newestTask(product.id)).toMatchObject({
        status: 'suggested', suggestionSource: 'overflow', quantity: SMALL_UNITS,
        recommendedLocationId: o1.id, assignedLocationId: null, assignedBy: null,
      })
    })

    await test.step('the Assign tab lists it as "Home full"', async () => {
      await openPutawayStage(page, world, 'Assign')
      await expect(queueRow(page, product).getByText(COPY.assignBadge, { exact: true })).toBeVisible()
      await shot(page, testInfo, '2a-assign-tab-home-full')
    })

    await test.step('the Walk tab lists it as a stop that needs confirming; the open stop asks for O1', async () => {
      await openPutawayStage(page, world, 'Walk')
      await expect(walkStop(page, product, o1.code).getByText(COPY.walkBadge)).toBeVisible()
      await openStopCard(page, product, o1.code)
      await expect(page.getByText(COPY.confirmHeading(o1.code))).toBeVisible()
      await identifyProduct(page, product)
      await expect(binScanField(page, COPY.confirmScanLabel(o1.code))).toBeVisible()
      await expect(page.getByText(COPY.confirmHelper)).toBeVisible()
      await shot(page, testInfo, '2b-walk-confirm-stop')
    })

    await test.step('scanning O2 is refused in words; scanning O1 confirms it', async () => {
      await scanBinAs(page, COPY.confirmScanLabel(o1.code), o2.code)
      await expect(page.getByText(COPY.confirmWrongBin(o1.code))).toBeVisible()
      await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0)
      expect((await newestTask(product.id)).status).toBe('suggested')
      await shot(page, testInfo, '2c-wrong-bin-refused')

      await scanBinAs(page, COPY.confirmScanLabel(o1.code), o1.code)
      await expect(page.getByText(COPY.confirmToast(o1.code))).toBeVisible()
      expect(await newestTask(product.id)).toMatchObject({ status: 'assigned', assignedLocationId: o1.id })
      expect((await newestTask(product.id)).assignedBy).not.toBeNull()
    })

    await test.step('count and confirm: placed at O1, and the Assign tab no longer lists it', async () => {
      await confirmCount(page)
      await expect(page.getByText(`Placed in ${o1.code}`)).toBeVisible()
      await shot(page, testInfo, '2d-placed-at-overflow')
      expect(await onHandAt(product.id, o1.id)).toBe(SMALL_UNITS)
      expect((await newestTask(product.id)).status).toBe('accepted')

      await openPutawayStage(page, world, 'Assign')
      await expect(page.getByText(COPY.assignQueueEmpty)).toBeVisible()
      await expect(queueRow(page, product)).toHaveCount(0)
    })
  })

  test('3. the reverse: the desk assigns first, and the walker is told so and carries on', async ({ adminPage: page }, testInfo) => {
    test.setTimeout(STORY_TIMEOUT)
    const { o1 } = world.bins
    const product = world.homed

    // The second page is the same Admin login, in a second tab of the same browser.
    const walker = await page.context().newPage()
    try {
      await test.step('receive 2 cartons: another suggested overflow task for O1', async () => {
        await receiveCartons(page, world, product, SMALL_CARTONS)
        expect(await newestTask(product.id)).toMatchObject({
          status: 'suggested', suggestionSource: 'overflow', quantity: SMALL_UNITS, recommendedLocationId: o1.id,
        })
      })

      await test.step('in the second page, open the Walk and the overflow stop up to the bin step', async () => {
        await walker.goto('/')
        await openOverflowStopAtBin(walker, product, o1)
        await shot(walker, testInfo, '3a-walker-at-the-bin-step')
      })

      await test.step('in the first page, the desk presses Assign on the queue row', async () => {
        await assignInQueue(page, product, world.warehouseCode)
        expect(await newestTask(product.id)).toMatchObject({ status: 'assigned', assignedLocationId: o1.id })
      })

      await test.step('in the second page, scanning O1 shows the server\'s words', async () => {
        await scanBinAs(walker, COPY.confirmScanLabel(o1.code), o1.code)
        // Said in the field and as a toast; either is the walker being told.
        await expect(walker.getByText(COPY.alreadyDealtWith).first()).toBeVisible()
        await shot(walker, testInfo, '3b-walker-told-the-desk-got-there-first')
        expect(await onHandAt(product.id, o1.id)).toBe(SMALL_UNITS)
      })

      await test.step('after the refresh the stop is a plain stop and completes normally', async () => {
        const plainLabel = `Scan the bin — expecting ${o1.code}`
        await expect(binScanField(walker, plainLabel)).toBeVisible()
        await expect(walker.getByText(/Home full/)).toHaveCount(0)
        await scanBinAs(walker, plainLabel, o1.code)
        await confirmCount(walker)
        await expect(walker.getByText(`Placed in ${o1.code}`)).toBeVisible()
        await shot(walker, testInfo, '3c-placed-after-the-desk-assigned')
        expect(await onHandAt(product.id, o1.id)).toBe(2 * SMALL_UNITS)
        expect((await newestTask(product.id)).status).toBe('accepted')
      })
    } finally {
      await walker.close()
    }
  })

  test('4. no home: the manager gives it one from the walk, by scan, by typing and by the dropdown', async ({ adminPage: page }, testInfo) => {
    test.setTimeout(STORY_TIMEOUT)
    const { n1, n2, n3, i } = world.bins
    const cases: ReadonlyArray<{ product: WorldProduct; bin: WorldBin; method: HomeMethod }> = [
      { product: world.noHome.p301, bin: n1, method: 'scan' },
      { product: world.noHome.p302, bin: n2, method: 'type' },
      { product: world.noHome.p303, bin: n3, method: 'pick' },
    ]

    for (const { product, bin, method } of cases) {
      await test.step(`${product.sku}: choose ${bin.code} by ${method}`, async () => {
        await receiveCartons(page, world, product, 1)
        const task = await newestTask(product.id)
        expect(task).toMatchObject({ status: 'assigned', suggestionSource: 'engine', assignedBy: null })
        const engineBin = binCodeOf(world, task.assignedLocationId)

        await openPutawayStage(page, world, 'Walk')
        await openStopCard(page, product, engineBin)
        const sheet = await openGiveHome(page, product.sku)
        // The inactive bin is not offered, in the list or by name.
        await expect(sheet.getByLabel(COPY.pickField).locator('option', { hasText: i.code })).toHaveCount(0)
        await expect(sheet.getByLabel(COPY.pickField).locator('option', { hasText: bin.code })).toHaveCount(1)
        if (method === 'scan') {
          await chooseHome(sheet, i, 'scan')
          await expect(sheet.getByText(COPY.notOffered(i.code))).toBeVisible()
        }
        await shot(page, testInfo, `4-${product.sku}-chooser`)
        await chooseHome(sheet, bin, method)
        await expect(sheet).toHaveCount(0)

        await identifyProduct(page, product)
        await scanBinAs(page, COPY.homeScanLabel(bin.code), bin.code)
        await confirmCount(page)
        await expect(page.getByText(COPY.placedAndSet(bin.code, product.sku))).toBeVisible()
        await shot(page, testInfo, `4-${product.sku}-placed-and-set`)

        expect(await homeOf(world, product.id)).toMatchObject({ binId: bin.id })
        expect(await onHandAt(product.id, bin.id)).toBe(CARTON_SIZE)
      })
    }
  })

  test('5. a Warehouse user is shown no offer, and a forged make_home is refused', async ({ adminPage: page, browser }, testInfo) => {
    test.setTimeout(STORY_TIMEOUT)
    const { n1 } = world.bins
    const product = world.noHome.p304

    await test.step('receive 1 carton of a product with no home: assigned by the engine', async () => {
      await receiveCartons(page, world, product, 1)
      expect(await newestTask(product.id)).toMatchObject({ status: 'assigned', suggestionSource: 'engine', assignedBy: null })
    })

    const baseURL = testInfo.project.use.baseURL
    const context = await browser.newContext({ baseURL })
    try {
      const walker = await context.newPage()
      const task = await newestTask(product.id)

      await test.step('signed in as the Warehouse user, the stop shows no offer', async () => {
        await loginAs(walker, world.user)
        await openPutawayStage(walker, world, 'Walk')
        await openStopCard(walker, product, binCodeOf(world, task.assignedLocationId))
        await expect(walker.getByText(COPY.offer)).toHaveCount(0)
        await identifyProduct(walker, product)
        // On the bin step, where the offer would be: still nothing to give a home.
        await expect(walker.getByLabel(/^Scan the bin/)).toBeVisible()
        await expect(identifyField(walker)).toHaveCount(0)
        await expect(walker.getByText(COPY.offer)).toHaveCount(0)
        await expect(walker.getByRole('button', { name: 'Give it a home' })).toHaveCount(0)
        await shot(walker, testInfo, '5a-warehouse-user-no-offer')
      })

      await test.step('a forged make_home is refused by the server, and nothing moves', async () => {
        const reply = await callFunction(walker, 'complete-putaway', {
          recommendation_id: task.id, make_home: true, scan: { locationCode: n1.code },
        })
        expect(reply.status).toBe(403)
        expect(reply.body.error).toMatchObject({ code: 'FORBIDDEN', message: COPY.forbidden })
        expect(await homeOf(world, product.id)).toBeNull()
        expect(await onHandAnywhere(product.id, world)).toBe(0)
        expect(await newestTask(product.id)).toMatchObject({ id: task.id, status: 'assigned' })
      })
    } finally {
      await context.close()
    }
  })
})
