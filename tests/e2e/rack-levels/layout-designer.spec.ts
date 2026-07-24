// Rack levels — Layout Designer per-rack level override + multi-select apply.
//
// Depends on: migration 00072 (verified NOT yet applied to prod as of writing
// — `has_levels`/`level_template` columns don't exist on storage_types yet),
// PLUS the Storage Forms editor from ../storage-forms.spec.ts actually being
// used to opt "Pallet Rack" into levels (RackWizard/PlacementInspector below
// only show a level editor when the chosen form's `hasLevels` is true).
//
// Unlike the other rack-levels specs, large parts of the DESIGNER side are
// already implemented (confirmed by reading the source, 2026-07-24):
//   - components/warehouse/levels/RackLevelEditor.tsx (real, complete)
//   - PlacementInspector.tsx mounts it for a selected draft rack
//   - useLayoutEditorState.ts has `set_rack_levels` / `apply_levels_to_selection`
// But two integration pieces are confirmed MISSING:
//   - LayoutCanvas.tsx never dispatches `{type:'select', additive:true}` — its
//     'select'-tool click handler always single-selects, so shift/ctrl-click
//     multi-select has no wiring on the canvas yet.
//   - LayoutDesignerView.tsx doesn't pass `selectedCount` to <PlacementInspector>,
//     so the "Apply this level layout to all N selected racks" button can
//     never appear regardless of the canvas gap above.
// So: the single-rack override step below may start passing before the
// multi-select step does — that's expected and it's why they're separate
// assertions rather than one all-or-nothing test.
import { expect, test } from '../fixtures/auth'
import { openSettingsWarehouseSubtab } from './helpers'

// A dedicated, permanently-named fixture warehouse (mirrors the existing
// wie-demo / tridon-demo pattern) so this suite never touches MAIN, which
// already holds live stock and a published layout — there is no
// delete-warehouse Edge Function, so a per-run throwaway can't be cleaned up,
// and publishing over MAIN's routing graph is exactly the kind of
// prod-destructive action E2E tests must avoid.
const TEST_WAREHOUSE_NAME = 'E2E RackLevels Test'
const TEST_WAREHOUSE_CODE = 'E2ERACKLVL'

test.describe('Rack levels — Layout Designer [NOT YET SHIPPED end-to-end, depends on mig 00072 + Storage Forms editor]', () => {
  test('override one rack to 4 levels; multi-select apply is a documented known gap', async ({ adminPage: page }) => {
    // This spec drives many sequential steps (warehouse setup, draft
    // creation, rack generation, a reload-and-reselect round trip) — triple
    // the default timeout rather than race a slow CI/dev box.
    test.slow()
    await openSettingsWarehouseSubtab(page)

    if (!(await page.getByText(TEST_WAREHOUSE_NAME, { exact: true }).count())) {
      await page.getByRole('button', { name: 'Add warehouse' }).click()
      // Not `exact` alone — Settings' General tab ("Company Name") stays
      // mounted-but-hidden (SettingsView keeps visited sub-tabs alive) and
      // `getByLabel` substring-matches across the whole page by default, so
      // an unqualified 'Name' resolves both fields in strict mode.
      await page.getByLabel('Code', { exact: true }).fill(TEST_WAREHOUSE_CODE)
      await page.getByLabel('Name', { exact: true }).fill(TEST_WAREHOUSE_NAME)
      await page.getByRole('button', { name: 'Racked (bins/WMS)' }).click()
      await page.getByRole('button', { name: 'Create warehouse' }).click()
      await expect(page.getByText(TEST_WAREHOUSE_NAME, { exact: true })).toBeVisible({ timeout: 10_000 })
    }

    await page.getByRole('button', { name: `Layout designer for ${TEST_WAREHOUSE_NAME}` }).click()
    await expect(page.getByRole('heading', { name: 'Warehouse Intelligence — Layout Designer' })).toBeVisible()

    await page.getByRole('button', { name: 'New draft' }).click()
    await expect(page.getByText(/draft created/i)).toBeVisible({ timeout: 10_000 })

    try {
      // Populate 3 racks via the existing RackWizard rather than hand-drawing
      // on the SVG canvas (no per-cell test hooks exist there today).
      await page.getByRole('button', { name: /generate racks/i }).click()
      await page.getByLabel('Storage type').selectOption({ label: 'Pallet Rack' })
      await page.getByLabel('Columns').fill('3')
      await page.getByLabel('Rows').fill('1')
      await page.getByRole('button', { name: /^Generate 3$/ }).click()

      // Select the first generated rack. LayoutCanvas has no per-rack test
      // hook, so click by grid position via the one interaction rect.
      await page.locator('svg[aria-label="Warehouse layout grid"] rect[fill="transparent"]').click({ position: { x: 4, y: 4 } })
      await expect(page.getByRole('heading', { name: 'Rack', exact: false })).toBeVisible()

      // Real RackLevelEditor selectors (component confirmed to exist):
      const levelsHeading = page.getByRole('heading', { name: 'Levels' })
      await expect(levelsHeading).toBeVisible({ timeout: 5_000 })
      await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(5) // PALLET_RACK standard: 5 levels

      // Override: remove L5 (the bulk level) so this rack has 4, not 5.
      await page.getByRole('button', { name: 'Remove level 5' }).click()
      await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(4)

      await page.getByRole('button', { name: /^save$/i }).click()
      await expect(page.getByText(/^saved\.?$/i)).toBeVisible({ timeout: 5_000 })

      await page.reload()
      await openSettingsWarehouseSubtab(page)
      await page.getByRole('button', { name: `Layout designer for ${TEST_WAREHOUSE_NAME}` }).click()
      await page.getByText(/^Layout \d{4}$/).first().click()
      await page.locator('svg[aria-label="Warehouse layout grid"] rect[fill="transparent"]').click({ position: { x: 4, y: 4 } })
      await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(4)

      // --- Known gap (see file header): multi-select + apply. Selecting a
      // second rack with Shift held should add it to selectedRefs and surface
      // "Apply this level layout to all N selected racks" — neither the
      // canvas's additive-select dispatch nor the selectedCount prop wiring
      // exist yet, so this is expected to fail until both land.
      await page.locator('svg[aria-label="Warehouse layout grid"] rect[fill="transparent"]').click({ position: { x: 5, y: 4 }, modifiers: ['Shift'] })
      await expect(page.getByRole('button', { name: /^Apply this level layout to all \d+ selected racks$/ })).toBeVisible({ timeout: 5_000 })
    } finally {
      // Best-effort cleanup: delete the draft we created so repeated runs
      // don't accumulate throwaway layouts against the fixture warehouse.
      const deleteDraft = page.getByRole('button', { name: /^Delete Layout \d{4}$/ }).first()
      if (await deleteDraft.count()) {
        await deleteDraft.click()
        await page.getByRole('button', { name: 'Confirm delete' }).click()
      }
    }
  })
})
