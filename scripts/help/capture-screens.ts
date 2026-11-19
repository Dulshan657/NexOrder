// Captures the screenshots for the Receipt & Putaway quick guide (NX-0038).
//
//   npm run help:shots                       # against a local `npm run dev`
//   npm run help:shots -- --base=https://nexorder.vercel.app
//
// It drives ONE real delivery through the demo, end to end: receive three
// cartons under a GUIDE-<date> reference, carry them to their home bin, look the
// bin up, then the supervisor's Assign screen. That writes stock, so it is
// refused anywhere but the demo or a local server (see captureBase.ts) -- and
// `npm run export:demo` should be run first, the demo's only backup.
//
// It signs in with the demo login page's role chips, which exist only on a demo
// build, so a run pointed anywhere else would fail at login regardless.
//
// Output: components/help/shots/*.png, imported by the articles. Re-run after a
// change to any screen the guide shows, and update the date in
// docs/claude/help-centre.md.

import { chromium, type Browser, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertCaptureBase } from './captureBase'

const OUT = resolve('components/help/shots')
const PHONE = { width: 360, height: 664 }
const DESK = { width: 1280, height: 800 }

/** The one product the run receives. A demo SKU with a barcode, a supplier and a home bin in MAIN. */
const PRODUCT = {
  name: 'Roasted Curry Powder - 200g X 40',
  barcode: '4792082500627',
  supplier: 'Amadiya Agro Products Pty Ltd',
}
/** The guide is shot in the demo's Amadiya warehouse; the run's logins must be homed there. */
const WAREHOUSE = 'Amadiya'
const CARTONS = 3

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

async function shot(page: Page, name: string): Promise<void> {
  await dismissToasts(page)
  await page.waitForTimeout(600) // let transitions settle
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(`  ✓ ${name}.png`)
}

async function dismissToasts(page: Page): Promise<void> {
  for (const btn of await page.getByRole('button', { name: /^(Close|Dismiss)$/ }).all()) {
    await btn.click({ timeout: 1000 }).catch(() => undefined)
  }
}

/** Demo-only login: the chip fills the form, then Sign in. Lands on `tab`. */
async function signIn(page: Page, base: string, role: 'Warehouse' | 'Admin', tab: string): Promise<void> {
  await page.goto(`${base}/?tab=${encodeURIComponent(tab)}`)
  const chip = page
    .getByRole('button', {
      name: new RegExp(`Fill the form with the ${role} account`, 'i'),
    })
    .first()
  await chip.waitFor({ state: 'visible', timeout: 30_000 })
  await chip.click()
  await page.getByRole('button', { name: /^Sign in$/ }).click()
  await page.getByRole('navigation').first().waitFor({ state: 'attached', timeout: 30_000 })
  await page.waitForTimeout(3000)
  await dismissToasts(page)
}

/** Types into the focused scan field and presses Enter, as a wedge scanner does. */
async function scanInto(page: Page, field: ReturnType<Page['locator']>, code: string): Promise<void> {
  await field.click()
  await field.fill(code)
  await field.press('Enter')
  await page.waitForTimeout(900)
}

/** Points a page's warehouse <select> at the guide's warehouse, when the page has one. */
async function pickWarehouse(page: Page): Promise<void> {
  const select = page.locator('select').filter({ has: page.locator('option', { hasText: WAREHOUSE }) }).first()
  if (!(await select.count())) return
  const value = await select.evaluate(
    (el, name) => [...(el as HTMLSelectElement).options].find((o) => o.text.startsWith(name))?.value ?? '',
    WAREHOUSE,
  )
  if (value) await select.selectOption(value)
  await page.waitForTimeout(1500)
}

async function floorRun(
  browser: Browser,
  base: string,
  reference: string,
  fromWalk: boolean,
): Promise<string> {
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const page = await ctx.newPage()
  try {
    if (fromWalk) {
      // Resume after a run that received but failed later: receiving again would
      // leave two open lines for the product and make its scan ambiguous.
      await signIn(page, base, 'Warehouse', 'Putaway')
    } else {
      await signIn(page, base, 'Warehouse', 'Receiving')
      await shot(page, 'receive-start')

      // Delivery details. Reference first: picking a supplier may collapse the strip.
      await page.getByPlaceholder('Invoice / docket / PO no.').fill(reference)
      const supplier = page.getByRole('textbox', { name: 'Supplier' })
      await supplier.click()
      await supplier.fill(PRODUCT.supplier.split(' ')[0])
      await shot(page, 'receive-supplier')
      await page.getByRole('button', { name: PRODUCT.supplier, exact: true }).click()
      await shot(page, 'receive-delivery')

      // Scan the cartons.
      const scan = page.getByPlaceholder(/Scan a carton/i)
      for (let i = 0; i < CARTONS; i++) await scanInto(page, scan, PRODUCT.barcode)
      await shot(page, 'receive-scanned')

      await page.getByRole('button', { name: /^Receive \d+ line/ }).click()
      await page.getByRole('region', { name: 'Receipt recorded' }).waitFor({ timeout: 30_000 })
      await shot(page, 'receive-done')

      // Putaway: the walk.
      await page.getByRole('button', { name: /Go to putaway/i }).click()
    }
    await page
      .getByRole('tab', { name: /Walk/ })
      .click()
      .catch(() => undefined)
    await page.waitForTimeout(1500)
    await shot(page, 'putaway-walk')

    // The walk's scan bar finds the stop; the stop then asks for the goods and the bin.
    await scanInto(page, page.getByLabel('Scan a plate, carton or bin'), PRODUCT.barcode)
    // The scan scrolls to the stop; a tap opens it.
    if (
      !(await page
        .getByText('Take it to')
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      await page.getByText(PRODUCT.name.slice(0, 20)).first().click()
      await page.waitForTimeout(1200)
    }
    const identify = page.getByLabel(/^Scan the (product|plate)/)
    if (await identify.isVisible().catch(() => false)) {
      await scanInto(page, identify, PRODUCT.barcode)
    }
    await page.getByText('Take it to').first().waitFor({ timeout: 15_000 })
    await shot(page, 'putaway-bin')

    const binField = page.getByLabel(/^Scan the bin/)
    const binCode = (await binField.getAttribute('placeholder'))?.trim() ?? ''
    await scanInto(page, binField, binCode)
    await page.getByText(/How much did you put away/i).waitFor({ timeout: 15_000 })
    await shot(page, 'putaway-count')

    await page.getByRole('button', { name: /^Confirm$/ }).click()
    await page.waitForTimeout(2000)


    // Check it landed.
    await page.goto(`${base}/?tab=Stock`)
    await page.waitForTimeout(2500)
    await page
      .getByRole('button', { name: /^Look up$/ })
      .click()
      .catch(() => undefined)
    const lookup = page.getByRole('textbox').last()
    await scanInto(page, lookup, binCode)
    await page.waitForTimeout(1500)
    await shot(page, 'stock-lookup')
    return binCode
  } catch (err) {
    await page.screenshot({ path: join(OUT, '_debug-floor.png') })
    throw err
  } finally {
    await ctx.close()
  }
}

async function supervisorRun(browser: Browser, base: string): Promise<void> {
  const ctx = await browser.newContext({ viewport: DESK })
  const page = await ctx.newPage()
  try {
    await signIn(page, base, 'Admin', 'Putaway')
    await pickWarehouse(page)
    await page.getByRole('button', { name: /^Assign$/ }).first().click().catch(() => undefined)
    await page.waitForTimeout(2500)
    await shot(page, 'putaway-assign')
  } catch (err) {
    await page.screenshot({ path: join(OUT, '_debug-supervisor.png') })
    throw err
  } finally {
    await ctx.close()
  }
}

async function main(): Promise<void> {
  const base = assertCaptureBase(argValue('base') ?? 'http://localhost:3000')
  const only = argValue('only') // floor | supervisor
  const fromWalk = argValue('from') === 'walk'
  const reference = `GUIDE-${new Date().toISOString().slice(0, 10)}`
  mkdirSync(OUT, { recursive: true })
  console.log(`Capturing help screenshots from ${base} (reference ${reference})`)

  const browser = await chromium.launch()
  try {
    if (only !== 'supervisor') {
      const bin = await floorRun(browser, base, reference, fromWalk)
      console.log(`  received ${CARTONS} x ${PRODUCT.name} and put it away in ${bin}`)
    }
    if (only !== 'floor') await supervisorRun(browser, base)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
