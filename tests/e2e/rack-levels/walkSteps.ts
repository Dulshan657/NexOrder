// Screen steps for putaway-straight-to-walk.spec.ts, one function per thing a
// person does. Kept apart from the spec so the spec reads as the story it is
// proving. The generic ones (scan, receiveCartons, openWalkStop, scanBin,
// confirmCount, callFunction, assignInQueue) are homeBlockSteps'; these are the
// ones this story adds.
//
// Each one drives the real screens; none of them touches the database.
import type { Locator, Page, TestInfo } from '@playwright/test'
import { expect } from '../fixtures/auth'
import { scan } from './homeBlockSteps'
import { openPutawayQueue, selectPutawayWarehouse } from './helpers'
import type { WalkWorld, WorldBin, WorldProduct } from './walkWorld'

/** The words the screens and the server use, fixed by the plan's copy table. */
export const COPY = {
  assignBadge: 'Home full',
  walkBadge: 'Home full — confirm',
  assignQueueEmpty: 'Nothing to put away',
  confirmHeading: (bin: string) => `Home full — put in ${bin}?`,
  confirmScanLabel: (bin: string) => `Scan ${bin} to confirm`,
  confirmHelper: 'Scanning this bin confirms it. The desk can choose another bin instead.',
  confirmWrongBin: (bin: string) =>
    `Scan ${bin} to confirm this overflow bin, or leave it for the desk to choose another.`,
  confirmToast: (bin: string) => `Confirmed — put it in ${bin}`,
  alreadyDealtWith: 'This line was already dealt with (it is now assigned).',
  offer: 'This product has no home bin. Give it one?',
  giveHomeSheet: (sku: string) => `Give ${sku} a home bin`,
  codeField: 'Scan or type the bin code',
  pickField: 'Or pick a bin',
  makeHome: 'Make this its home',
  notOffered: (code: string) => `${code} can't be this product's home. Pick one of the bins listed.`,
  homeScanLabel: (bin: string) => `Scan ${bin} — it becomes the home bin`,
  placedAndSet: (bin: string, sku: string) => `Placed in ${bin} — it is now ${sku}'s home bin`,
  forbidden: 'Only a Manager or Admin can give a product a home bin.',
} as const

export type StageName = 'Assign' | 'Walk'

/** Keep a named picture of the screen, as a file in the run's output folder. */
export async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

/** The code of one of the world's bins, from the id a task row holds. */
export function binCodeOf(world: WalkWorld, locationId: number | null): string {
  const bin = (Object.values(world.bins) as WorldBin[]).find((b) => b.id === locationId)
  if (!bin) throw new Error(`location ${String(locationId)} is not one of the world's bins`)
  return bin.code
}

// ── Putaway page ─────────────────────────────────────────────────────────────

/** Putaway, with the world's warehouse picked, on the Assign or the Walk tab. */
export async function openPutawayStage(page: Page, world: WalkWorld, stage: StageName): Promise<void> {
  await openPutawayQueue(page)
  await selectPutawayWarehouse(page, world.warehouseCode)
  await page
    .getByRole('navigation', { name: 'Putaway stage' })
    .getByRole('button', { name: new RegExp(`^${stage}`) })
    .click()
}

/** The Assign queue's row for `product`: present only if that line waits for the desk. */
export function queueRow(page: Page, product: WorldProduct): Locator {
  return page.locator('div.px-4.py-3', {
    has: page.getByRole('button', { name: `Why this bin for ${product.name}?` }),
  })
}

/** The Walk's collapsed stop for `product` at `binCode`. */
export function walkStop(page: Page, product: WorldProduct, binCode: string): Locator {
  return page.getByRole('button').filter({ hasText: product.name }).filter({ hasText: binCode })
}

/** Open the stop and nothing more: the card is on its first step. */
export async function openStopCard(page: Page, product: WorldProduct, binCode: string): Promise<void> {
  await walkStop(page, product, binCode).click()
  await expect(identifyField(page)).toBeVisible()
}

/** The field that asks what is being carried: a product barcode on these carton plates. */
export function identifyField(page: Page): Locator {
  return page.getByLabel(/^Scan the (product|plate)/)
}

/** Hold the product up to the gun. The card moves on to the bin step. */
export async function identifyProduct(page: Page, product: WorldProduct): Promise<void> {
  await scan(identifyField(page), product.barcode)
}

/** The bin scan field, by the exact label the card gives it at this point of the story. */
export function binScanField(page: Page, label: string): Locator {
  return page.getByLabel(label, { exact: true })
}

export async function scanBinAs(page: Page, label: string, binCode: string): Promise<void> {
  await scan(binScanField(page, label), binCode)
}

// ── Give a product a home (the sheet) ────────────────────────────────────────

export type HomeMethod = 'scan' | 'type' | 'pick'

export function giveHomeSheet(page: Page, sku: string): Locator {
  return page.getByRole('dialog', { name: COPY.giveHomeSheet(sku) })
}

export async function openGiveHome(page: Page, sku: string): Promise<Locator> {
  await expect(page.getByText(COPY.offer)).toBeVisible()
  await page.getByRole('button', { name: 'Give it a home' }).click()
  const sheet = giveHomeSheet(page, sku)
  await expect(sheet).toBeVisible()
  // The bins are listed once they have loaded; "Loading bins…" is gone by then.
  await expect(sheet.getByLabel(COPY.pickField)).toBeVisible()
  return sheet
}

/**
 * Name `bin` as the home the way a manager would: scan its label (the gun types
 * the code and presses Enter), type it by hand (a key at a time, then press the
 * button), or pick it from the list (then press the button).
 */
export async function chooseHome(sheet: Locator, bin: WorldBin, method: HomeMethod): Promise<void> {
  const makeHome = sheet.getByRole('button', { name: COPY.makeHome })
  if (method === 'scan') {
    await scan(sheet.getByLabel(COPY.codeField), bin.code)
    return
  }
  if (method === 'type') {
    // A key at a time and slower than a gun, so the field reads it as a person
    // typing (it commits a fast run by itself) and the button is what commits it.
    await sheet.getByLabel(COPY.codeField).pressSequentially(bin.code, { delay: 120 })
    await makeHome.click()
    return
  }
  await sheet.getByLabel(COPY.pickField).selectOption(bin.code)
  await makeHome.click()
}
