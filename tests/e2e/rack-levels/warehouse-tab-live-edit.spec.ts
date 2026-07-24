// Rack levels — Warehouse tab expand-in-place + live level edit.
//
// Depends on: migration 00072 (not yet applied to prod) AND at least one real
// MAIN rack having gone through `wie_convert_rack_to_levels_tx` (the plan's
// "MAIN conversion" step). As of writing, NEITHER exists — confirmed by
// reading source:
//   - components/inventory/warehouse/WarehouseCanvas.tsx still renders one
//     rect per placement 1:1; it does not group by (floor, x, y), so there is
//     no "rack" grouping to click, let alone an exploded-levels overlay.
//   - components/inventory/warehouse/BinDetailPanel.tsx is still read-only
//     (per its own file header) and does not mount RackLevelEditor.
// This spec is written against the real MAIN warehouse — read-only clicks
// only (selecting a bin never mutates anything), so it is safe to run
// against prod even though the assertions are expected to fail.
import { expect, test } from '../fixtures/auth'
import { openWarehouseTab } from './helpers'

test.describe('Rack levels — Warehouse tab expand-in-place [NOT YET SHIPPED, depends on mig 00072 + a converted MAIN rack]', () => {
  test('clicking a rack shows its levels, and editing one live needs no re-publish', async ({ adminPage: page }) => {
    await openWarehouseTab(page)

    // Select any real rack via the (existing, accessible) location tree
    // rather than raw SVG map coordinates — clicking a tree row is read-only.
    const treeRow = page.locator('button').filter({ hasText: /^[A-Z0-9-]+/ }).first()
    await treeRow.click({ timeout: 10_000 })

    // --- Speculative: expand-in-place. The plan calls for clicking a RACK
    // group on the map to explode it into its levels with a translucent scrim
    // over the rest of the grid; today the tree/map selection only ever opens
    // the flat <BinDetailPanel>, which has no level concept at all.
    await expect(page.getByRole('heading', { name: 'Levels' })).toBeVisible({ timeout: 5_000 })

    // Live edit: change a level's role in place and confirm no "Publish"
    // action is required — BinDetailPanel would need to call the new
    // mutate-warehouse-location `set_levels` action directly.
    await page.getByLabel('Role').first().selectOption('reserve')
    await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /publish/i })).toHaveCount(0)
  })
})
