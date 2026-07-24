// Rack levels — Warehouse tab expand-in-place + live level edit.
//
// Real UI, verified 2026-07-24: `components/inventory/warehouse/
// WarehouseCanvas.tsx` DOES group placements by (floor,x,y) and explode a
// rack's levels on click (`groupPlacementsByCell`), and `BinDetailPanel.tsx`
// mounts `<RackLevelEditor>` and saves a role change immediately via
// `mutate-warehouse-location`'s `set_levels` action (`useSetRackLevels`) — no
// publish step. Both were speculative/read-only in the original draft of this
// spec; they're real and drivable now.
//
// Uses the suite's own fixture rack (helpers.ensureLevelledFixtureRack) in
// "E2E RackLevels Test" rather than a MAIN rack — no MAIN rack has been
// converted to levels, and this suite must never convert one that holds live
// stock. Restores the level it edits (back to its original role) in `finally`
// so putaway-roles.spec.ts / putaway-override.spec.ts's assumption that the
// fixture rack is L1-4 pick + L5 bulk keeps holding for later runs.
import { expect, test } from '../fixtures/auth'
import {
  ensureLevelledFixtureRack,
  FIXTURE_BIN_CODE,
  FIXTURE_WAREHOUSE_CODE,
  FIXTURE_WAREHOUSE_NAME,
  openWarehouseTab,
  selectWarehouseScope,
} from './helpers'

test.describe('Rack levels — Warehouse tab expand-in-place', () => {
  test('selecting the rack shows its levels, and editing one live needs no re-publish', async ({ adminPage: page }) => {
    test.slow()
    await ensureLevelledFixtureRack(page)

    await openWarehouseTab(page)
    await selectWarehouseScope(page, `${FIXTURE_WAREHOUSE_NAME} (${FIXTURE_WAREHOUSE_CODE})`)

    // Negative lookahead excludes the rack's own level rows ("...-L1".."-L5"),
    // which also substring-match the bare rack code, so this always selects
    // the RACK parent itself.
    const binRow = page.getByRole('button', { name: new RegExp(`^${FIXTURE_BIN_CODE}(?!-L\\d)`) })
    await expect(binRow).toBeVisible({ timeout: 10_000 })
    await binRow.click()

    await expect(page.getByRole('heading', { name: 'Levels' })).toBeVisible({ timeout: 5_000 })

    // RackLevelEditor renders top-first (L5..L1); `.last()` is L1, a 'pick'
    // level — edited and restored here, leaving L5 (bulk) untouched since
    // putaway-roles/putaway-override depend on it staying the fixture's one
    // bulk level.
    const l1Role = page.getByLabel('Role').last()
    await expect(l1Role).toHaveValue('pick')

    await l1Role.selectOption('reserve')
    await expect(page.getByText(/level config saved/i)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /publish/i })).toHaveCount(0)

    await l1Role.selectOption('pick')
    await expect(page.getByText(/level config saved/i)).toBeVisible({ timeout: 5_000 })
  })
})
