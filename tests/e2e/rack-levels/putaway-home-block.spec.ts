// NX-0032 -- putaway goes to the home bin, or is refused while the home has room.
//
// One story, on dev, in a browser, with made-up data this spec creates and
// removes (homeBlockWorld.ts): a warehouse TST-HOME-E2E with four pick bins
// (H, X, Y, Z), a published layout with a dock route, and two products,
// TST-HOME-200 (gets a home) and TST-HOME-300 (never does).
//
// DRIVEN THROUGH THE SCREENS
//   - set H as TST-HOME-200's home on Replenishment > Min/max setup, and read the
//     "Home bin problems" panel before and after;
//   - receive 4 cartons on Receive Stock (carton plates: a pallet is a unit load
//     and is never sent to a pick home), and read the suggestion;
//   - try another bin from the receive card ("Choose another bin" > "Put here");
//   - Putaway > Assign, then Walk: scan X (the card sends the worker back to H and
//     stays on the bin step), scan H on the same card (placed);
//   - with H full, receive again, and place the line in another bin on the walk;
//   - receive the second product and try to put it in H.
//
// READ FROM THE DATABASE
//   - the task's suggestion source (`home` / `overflow` / `engine`) and bin: no
//     screen shows the source, so it is asserted on wie_putaway_recommendations;
//   - stock on hand, so "refused" is shown to have moved nothing.
//
// SEEDED, NOT DRIVEN
//   - the warehouse, layout, bins and products (they are the fixture);
//   - deactivating H: the app refuses to deactivate a bin that holds stock, and H
//     holds some by then, so the bin is switched off in SQL and the panel is read;
//   - the reason on an overflow placement: the floor screens have no prompt for
//     it yet (NX-0006's reason rule is server-side only), so that one request is
//     sent to the deployed complete-putaway with the page's own session.
import type { Page, TestInfo } from '@playwright/test'
import { expect, test } from '../fixtures/auth'
import {
  assignInQueue,
  callFunction,
  binField,
  checkHomesAgain,
  confirmCount,
  expectNoWayPastTheBlock,
  healthPanel,
  homeRoomMessage,
  openMinMaxSetup,
  openSuggestions,
  openWalkStop,
  othersHomeMessage,
  putHereInstead,
  receiveCartons,
  scanBin,
  setHomeBin,
  walkAndScanBin,
  walkHomeMessage,
} from './homeBlockSteps'
import {
  CARTON_SIZE,
  deactivateBin,
  homeOf,
  leftovers,
  onHandAt,
  seedWorld,
  snapshotWorld,
  tasksOf,
  tearDownWorld,
  type TaskRow,
  type World,
} from './homeBlockWorld'

const CARTONS = 4
const LINE_UNITS = CARTONS * CARTON_SIZE

let world: World

test.use({ trace: 'on', screenshot: 'on' })

/** Keep a named picture of the screen, as a file in the run's output folder. */
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

test.describe('Putaway goes to the home bin, or is refused', () => {
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

  test('home bin or refused, from the setup screen to the health panel', async ({ adminPage: page }, testInfo) => {
    test.setTimeout(240_000) // one story of ten screens; the 30 s default is for a single screen
    const { h, x, y, z } = world.bins
    const sku = world.home.sku

    await test.step('1. Admin sets H as the home of TST-HOME-200; the health panel checks it and says "No problems"', async () => {
      await openMinMaxSetup(page, world)
      // Nothing is homed yet, so "No problems" here means nothing: it says 0 checked.
      await expect(healthPanel(page).getByText(/0 home bins checked/)).toBeVisible()
      await setHomeBin(page, world.home, h.code, 1, CARTONS)
      await checkHomesAgain(page)
      await expect(healthPanel(page).getByText('No problems')).toBeVisible()
      await expect(healthPanel(page).getByText(/1 home bin checked/)).toBeVisible()
      await shot(page, testInfo, '1-home-set-no-problems')
      // The maximum was typed in cartons; the database holds base units.
      expect(await homeOf(world, world.home.id)).toEqual({ binId: h.id, maxQty: LINE_UNITS })
    })

    await test.step('2. Receive 4 cartons: the putaway task suggests H, source home', async () => {
      await receiveCartons(page, world, world.home, CARTONS)
      await openSuggestions(page)
      await expect(
        page.getByRole('listitem').filter({ hasText: world.home.name }).filter({ hasText: `${LINE_UNITS} units → ${h.code}` }),
      ).toBeVisible()
      await shot(page, testInfo, '2-suggestion-is-the-home')
      const task = await newestTask(world.home.id)
      expect(task).toMatchObject({
        status: 'suggested', quantity: LINE_UNITS, recommendedLocationId: h.id, suggestionSource: 'home',
      })
    })

    await test.step('3. Another bin from the receive card is refused inline, with no way past it', async () => {
      await putHereInstead(page, x.code)
      await expect(page.getByRole('alert').filter({ hasText: homeRoomMessage(h.code, LINE_UNITS) })).toBeVisible()
      await expectNoWayPastTheBlock(page)
      await shot(page, testInfo, '3-receive-card-refusal')
      expect((await newestTask(world.home.id)).status).toBe('suggested')
      expect(await onHandAt(world.home.id, x.id)).toBe(0)
    })

    await test.step('4. Scanning bin X on the walk sends the worker back to H, and the card stays on the bin step', async () => {
      await assignInQueue(page, world.home)
      await openWalkStop(page, world.home, h.code)
      await expect(page.getByText(/This product's home bin. It goes here while the home has room/)).toBeVisible()
      await scanBin(page, x.code)
      await expect(page.getByRole('alert').filter({ hasText: walkHomeMessage(h.code) })).toBeVisible()
      // Not on the count step: the bin field is still there to rescan, there is
      // nothing to Confirm, and the "different bay is fine" copy never appeared.
      await expect(binField(page)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0)
      await expect(page.getByText(/That's allowed|different bay is fine/)).toHaveCount(0)
      await expectNoWayPastTheBlock(page)
      await shot(page, testInfo, '4-walk-sends-it-home')
      expect((await newestTask(world.home.id)).status).toBe('assigned')
      expect(await onHandAt(world.home.id, x.id)).toBe(0)
    })

    await test.step('5. Scanning H on the same card completes', async () => {
      await scanBin(page, h.code)
      await expect(page.getByRole('alert').filter({ hasText: walkHomeMessage(h.code) })).toHaveCount(0)
      await confirmCount(page)
      await expect(page.getByText(`Placed in ${h.code}`)).toBeVisible()
      await shot(page, testInfo, '5-placed-in-the-home')
      expect((await newestTask(world.home.id)).status).toBe('accepted')
      expect(await onHandAt(world.home.id, h.id)).toBe(LINE_UNITS)
    })

    await test.step('6. H is now at its maximum: the health panel lists it as full', async () => {
      await openMinMaxSetup(page, world)
      await checkHomesAgain(page)
      await expect(healthPanel(page).getByText(`Bin ${h.code} is full`)).toBeVisible()
      await shot(page, testInfo, '6-panel-lists-full')
    })

    await test.step('7. With H full, the next receipt goes to overflow and another bin is accepted', async () => {
      await receiveCartons(page, world, world.home, CARTONS)
      await openSuggestions(page)
      const task = await newestTask(world.home.id)
      expect(task).toMatchObject({ status: 'suggested', quantity: LINE_UNITS, suggestionSource: 'overflow' })
      const suggested = [x, y, z].find((b) => b.id === task.recommendedLocationId)
      if (!suggested) throw new Error('overflow was not suggested to one of the ordinary bins')
      await expect(
        page.getByRole('listitem').filter({ hasText: world.home.name }).filter({ hasText: `${LINE_UNITS} units → ${suggested.code}` }),
      ).toBeVisible()
      await shot(page, testInfo, '7a-suggestion-is-overflow')

      // Scan a different ordinary bin than the one suggested.
      const elsewhere = [x, y, z].find((b) => b.id !== suggested.id)!
      await assignInQueue(page, world.home)
      await walkAndScanBin(page, world.home, suggested.code, elsewhere.code)
      await confirmCount(page)
      await expect(page.getByText(`Placed in ${elsewhere.code} instead of ${suggested.code}`)).toBeVisible()
      await shot(page, testInfo, '7b-other-bin-accepted')
      expect((await newestTask(world.home.id)).status).toBe('overridden')
      expect(await onHandAt(world.home.id, elsewhere.id)).toBe(LINE_UNITS)
      expect(await onHandAt(world.home.id, h.id)).toBe(LINE_UNITS)
    })

    await test.step('8. A suggested overflow task goes elsewhere only with a reason (sent as the signed-in page)', async () => {
      await receiveCartons(page, world, world.home, CARTONS)
      const task = await newestTask(world.home.id)
      expect(task).toMatchObject({ status: 'suggested', suggestionSource: 'overflow' })
      const target = [x, y, z].find((b) => b.id !== task.recommendedLocationId)!

      // The home has no room, so the home rule passes and the NX-0006 reason rule speaks.
      const bare = await callFunction(page, 'complete-putaway', {
        recommendation_id: task.id, scan: { locationCode: target.code },
      })
      expect(bare.status).toBe(400)
      expect(bare.body.error?.message).toMatch(/say why/)

      const reasoned = await callFunction(page, 'complete-putaway', {
        recommendation_id: task.id, scan: { locationCode: target.code }, override_reason: 'full',
      })
      expect(reasoned.status).toBe(200)
      expect(reasoned.body.placedElsewhere).toBe(true)
      expect(await newestTask(world.home.id)).toMatchObject({ status: 'overridden', overrideReason: 'full' })
      expect(await onHandAt(world.home.id, h.id)).toBe(LINE_UNITS)
    })

    await test.step('9. A second product with no home is not offered H, and is refused it', async () => {
      await receiveCartons(page, world, world.other, CARTONS)
      await openSuggestions(page)
      const task = await newestTask(world.other.id)
      expect(task.status).toBe('suggested')
      expect(task.recommendedLocationId).not.toBeNull()
      expect(task.recommendedLocationId).not.toBe(h.id)
      expect(task.suggestionSource).toBe('engine')
      // Not the winner, and not among the alternatives the engine scored.
      expect(JSON.stringify(task.explanation)).not.toContain(h.code)
      await shot(page, testInfo, '9a-other-product-not-offered-h')

      await putHereInstead(page, h.code)
      await expect(page.getByRole('alert').filter({ hasText: othersHomeMessage(h.code, sku) })).toBeVisible()
      await expectNoWayPastTheBlock(page)
      await shot(page, testInfo, '9b-other-product-refused-h')
      expect((await newestTask(world.other.id)).status).toBe('suggested')
      expect(await onHandAt(world.other.id, h.id)).toBe(0)
    })

    await test.step('10. H is deactivated: the health panel lists it as inactive', async () => {
      await deactivateBin(h.id) // seeded: the app will not deactivate a bin that holds stock
      await openMinMaxSetup(page, world)
      await checkHomesAgain(page)
      const panel = healthPanel(page)
      await expect(panel.getByText(`Bin ${h.code} is inactive`)).toBeVisible()
      await expect(panel.getByText(sku, { exact: true })).toBeVisible()
      await shot(page, testInfo, '10-panel-lists-inactive')
    })
  })
})
