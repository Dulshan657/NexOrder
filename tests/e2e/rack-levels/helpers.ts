// Shared navigation helpers for the rack-levels suite. Kept separate from
// tests/e2e/fixtures so they can depend on app-specific text without
// touching the generic auth harness.
import type { Page } from '@playwright/test'
import { expect } from '../fixtures/auth'

/** Admin sidebar → Settings → "Warehouse" sub-tab (Storage Forms lives here). */
export async function openSettingsWarehouseSubtab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const subtabNav = page.getByRole('navigation', { name: 'Settings sub-navigation' })
  await subtabNav.getByRole('button', { name: 'Warehouse', exact: true }).click()
}

/** Admin sidebar → "Warehouse" (the map viewer / RackedWorkspace).
 *
 * Scoped to the sidebar (`<aside>`, the `complementary` landmark) — Settings'
 * sub-tab nav ALSO has a "Warehouse" button, and SettingsView keeps every
 * visited sub-tab mounted-but-hidden rather than unmounting it, so once a
 * test has opened Settings → Warehouse (e.g. via openSettingsWarehouseSubtab
 * / ensureLevelledFixtureRack) an unscoped query resolves two matches. */
export async function openWarehouseTab(page: Page): Promise<void> {
  await page.getByRole('complementary').getByRole('button', { name: 'Warehouse', exact: true }).click()
  await page.getByRole('heading', { name: 'Warehouse', exact: true }).waitFor({ state: 'visible' })
}

/** Admin sidebar → "Putaway" (the putaway queue). Not `exact` — the sidebar
 *  button appends a pending-count badge to its accessible name (e.g.
 *  "Putaway 12") whenever the queue is non-empty. */
export async function openPutawayQueue(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Putaway\b/ }).click()
  await expect(page.getByRole('heading', { name: 'Putaway', exact: true })).toBeVisible({ timeout: 10_000 })
}

/** Admin sidebar → "Pick Queue". */
export async function openPickQueue(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pick Queue', exact: true }).click()
}

/** Admin sidebar → "Receive Stock" (the sidebar label — NOT "Receiving",
 *  which is only the internal `adminView` state value). */
export async function openReceiving(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Receive Stock', exact: true }).click()
}

/** Admin sidebar → "Products". */
export async function openProducts(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Products', exact: true }).click()
}

/**
 * Opens the product edit form for the row whose name is EXACTLY
 * `productName` (assumes `openProducts` already ran). Products admin
 * (components/ProductAdmin.tsx) has no search box, so a row is found by
 * scanning the table; a substring `RegExp` on `getByRole('row', { name })`
 * is not safe here — e.g. "Coconut Milk 270ml" is also a substring of
 * "Light Coconut Milk 270ml", a real catalogue product, and resolves two rows.
 */
export async function openProductEdit(page: Page, productName: string): Promise<void> {
  const row = page.getByRole('row').filter({ has: page.getByText(productName, { exact: true }) })
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
}

/**
 * Picks the exact `productName` result out of ReceiveStockView's product
 * search dropdown (assumes the search box is already filled). Same
 * substring trap as `openProductEdit` — "Light Coconut Milk 270ml" also
 * matches a search for "Coconut Milk 270ml", so a plain `RegExp` name match
 * resolves two buttons.
 */
export async function pickReceivingSearchResult(page: Page, productName: string): Promise<void> {
  await page
    .getByRole('button')
    .filter({ has: page.getByText(productName, { exact: true }) })
    .click()
}

/**
 * Whether `locator` becomes visible within `timeoutMs` — for "does this
 * fixture already exist?" checks. Deliberately NOT `locator.count()`: the
 * underlying list (warehouses/layouts/storage forms) loads from a TanStack
 * Query fetch that hasn't necessarily resolved the instant the sub-tab
 * mounts, so a zero-wait `.count()` right after navigating can read "0" while
 * the real answer is "1, still loading" — false-negative into re-creating an
 * already-existing fixture and hitting a unique-constraint error server-side.
 */
export async function existsWithin(locator: import('@playwright/test').Locator, timeoutMs = 5_000): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false)
}

/** The permanent E2E fixture warehouse (see layout-designer.spec.ts's own
 *  header) — never delete, never publish a routing graph over live stock. */
export const FIXTURE_WAREHOUSE_NAME = 'E2E RackLevels Test'
export const FIXTURE_WAREHOUSE_CODE = 'E2ERACKLVL'
/** Bin code the fixture's single rack gets — `${codePrefix}-B-${x}-${y}`
 *  (useLayoutEditorState's own naming, codePrefix = warehouse code) for a bin
 *  painted at grid cell (0,0). */
export const FIXTURE_BIN_CODE = `${FIXTURE_WAREHOUSE_CODE}-B-0-0`

/** Warehouse-scope `<select aria-label="Warehouse scope">` (WarehousePicker,
 *  shared by Products/Warehouse/Stock/Dashboard). */
export async function selectWarehouseScope(page: Page, optionLabel: RegExp | string): Promise<void> {
  await page.getByLabel('Warehouse scope').selectOption({ label: optionLabel as string })
}

/**
 * Putaway Queue page's own (non-WarehousePicker) warehouse selector.
 *
 * NOT `page.getByLabel('Warehouse')` — that resolved 0 elements in practice
 * even though the DOM genuinely has `<label><span>Warehouse</span>
 * <select>…</select></label>` (confirmed via a raw HTML dump); Chromium's
 * accessible-name computation for THIS wrapping shape (text inside a sibling
 * `<span>`, not a bare text node — contrast StorageFormsView's plain
 * `<label>Code<input/></label>`, which getByLabel resolves fine) apparently
 * doesn't associate the way `getByLabel` expects. A plain CSS `<label>`
 * lookup sidesteps the question entirely.
 *
 * Its option label is `${name} (${code}) — N pending`/`— none`
 * (PutawayQueuePage.tsx's own `optionLabel`), so an exact-string match would
 * need to guess the live pending count — match by the `(code)` substring
 * instead and select by the resolved `value`.
 */
export async function selectPutawayWarehouse(page: Page, warehouseCode: string): Promise<void> {
  const select = page.locator('label', { hasText: 'Warehouse' }).locator('select')
  const value = await select.locator('option', { hasText: `(${warehouseCode})` }).getAttribute('value')
  if (!value) throw new Error(`No "Warehouse" option contains (${warehouseCode})`)
  await select.selectOption(value)
}

/**
 * Idempotent setup: ensures the fixture warehouse has ONE published layout
 * containing exactly one rack (`FIXTURE_BIN_CODE`), and that that rack has
 * been split into levels (mig 00072 `wie_convert_rack_to_levels_tx`) with the
 * PALLET_RACK standard template (4× pick + 1× bulk). Safe to call from every
 * spec that needs a real levelled, published rack — it holds zero stock, was
 * built entirely through this suite, and nothing here ever touches MAIN.
 *
 * Returns once the rack in `FIXTURE_WAREHOUSE_NAME` has 5 addressable levels
 * (L1-4 pick, L5 bulk). Every step first checks whether it's already done
 * (draft/publish/convert) so repeated runs don't create duplicate racks or
 * re-trigger the stock-moving conversion RPC on an already-converted rack.
 *
 * NOT safe to run concurrently against the SAME warehouse from two workers —
 * callers should keep this suite `--workers=1` (see tests/e2e/README.md) or
 * gate it behind a single serial describe block until the setup is hoisted
 * into a real Playwright globalSetup.
 */
export async function ensureLevelledFixtureRack(page: Page): Promise<void> {
  await ensurePublishedLayoutWithOneRack(page)
  await ensureRackConvertedToLevels(page)
}

async function ensurePublishedLayoutWithOneRack(page: Page): Promise<void> {
  await openSettingsWarehouseSubtab(page)
  const warehouseExists = await existsWithin(page.getByText(FIXTURE_WAREHOUSE_NAME, { exact: true }))
  if (!warehouseExists) {
    await page.getByRole('button', { name: 'Add warehouse' }).click()
    await page.getByLabel('Code', { exact: true }).fill(FIXTURE_WAREHOUSE_CODE)
    await page.getByLabel('Name', { exact: true }).fill(FIXTURE_WAREHOUSE_NAME)
    await page.getByRole('button', { name: 'Racked (bins/WMS)' }).click()
    await page.getByRole('button', { name: 'Create warehouse' }).click()
    await expect(page.getByText(FIXTURE_WAREHOUSE_NAME, { exact: true })).toBeVisible({ timeout: 10_000 })
  }

  await page.getByRole('button', { name: `Layout designer for ${FIXTURE_WAREHOUSE_NAME}` }).click()
  await expect(page.getByRole('heading', { name: 'Warehouse Intelligence — Layout Designer' })).toBeVisible()

  const publishedChip = page.locator('button', { hasText: 'published' })
  if (await existsWithin(publishedChip)) {
    // Already published in a previous run — nothing to draw.
    await page.getByRole('button', { name: 'Close designer' }).click()
    return
  }

  await page.getByRole('button', { name: 'New draft' }).click()
  await expect(page.getByText(/draft created/i)).toBeVisible({ timeout: 10_000 })

  // Paint exactly one bin, form doesn't matter (per-rack `levels` painted here
  // never persist — see the report's persistGeometry finding — the ONLY
  // working persistence path is BinDetailPanel's "Split into levels"), plus
  // one adjacent dock cell so the publish-readiness graph has an anchor.
  const grid = page.locator('svg[aria-label="Warehouse layout grid"] rect[fill="transparent"]')
  await page.getByRole('button', { name: 'Select', exact: true }).click() // ensure a known tool baseline
  await page.getByRole('button', { name: 'Pallet Rack', exact: true }).click()
  await grid.click({ position: { x: 4, y: 4 } }) // cell (0,0), BASE_CELL=26px
  await page.getByRole('button', { name: 'Dock', exact: true }).click()
  await grid.click({ position: { x: 30, y: 4 } }) // cell (1,0), orthogonally adjacent

  await page.getByRole('button', { name: /^save$/i }).click()
  await expect(page.getByText(/^saved\.?$/i)).toBeVisible({ timeout: 5_000 })

  await page.getByRole('button', { name: /^(publish|save & publish)$/i }).click()
  // Not a bare /published/i — the layout list's status chip ALSO reads
  // "published" once this succeeds, so an unscoped match is ambiguous
  // (strict-mode violation). The success notice's own copy is unique.
  await expect(page.getByText(/rack-level putaway/i)).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: 'Close designer' }).click()
}

async function ensureRackConvertedToLevels(page: Page): Promise<void> {
  await openWarehouseTab(page)
  await selectWarehouseScope(page, `${FIXTURE_WAREHOUSE_NAME} (${FIXTURE_WAREHOUSE_CODE})`)

  // Negative lookahead: once converted, the tree ALSO lists 5 level rows
  // ("E2ERACKLVL-B-0-0-L1" … "-L5"), each of which substring-matches the bare
  // rack code too — exclude those so this always selects the RACK parent
  // itself (BinDetailPanel resolves a rack's levels identically whether the
  // parent or one of its levels is selected).
  const binRow = page.getByRole('button', { name: new RegExp(`^${FIXTURE_BIN_CODE}(?!-L\\d)`) })
  await expect(binRow).toBeVisible({ timeout: 10_000 })
  await binRow.click()

  // Already converted (a previous run split it) — RackLevelEditor's "Levels"
  // heading only ever renders once `rackLevelLocations` is non-empty.
  if (await existsWithin(page.getByRole('heading', { name: 'Levels' }), 3_000)) return

  await page.getByRole('button', { name: /split into levels/i }).click()
  // Seeded from PALLET_RACK's own standard template (4× pick + 1× bulk) since
  // the bin's storage_type_id was set when we painted it with that tool.
  await page.getByRole('button', { name: /^convert to 5 levels?$/i }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Split into levels' })
    .click()
  await expect(page.getByText(/converted to 5 levels/i)).toBeVisible({ timeout: 10_000 })
}
