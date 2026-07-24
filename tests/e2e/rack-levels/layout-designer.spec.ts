// Rack levels — Layout Designer per-rack level override + multi-select apply.
//
// Cleared to run against prod: creates (or reuses) the permanent
// "E2E RackLevels Test" fixture warehouse. Everything INSIDE the warehouse —
// this spec's own draft layout and its racks — is torn down in `finally` on
// every run; only the empty warehouse shell (and, from other specs in this
// suite, its own separately-published fixture layout) may persist. Never
// touches MAIN.
//
// Real UI, verified 2026-07-24 (components/warehouse/levels/RackLevelEditor.tsx,
// components/admin/layout/PlacementInspector.tsx, LayoutCanvas.tsx,
// useLayoutEditorState.ts, LayoutDesignerView.tsx): shift/ctrl/cmd-click
// multi-select IS wired (LayoutCanvas dispatches `{type:'select', additive:
// true}` on a modifier-click) and `selectedCount` IS threaded into
// <PlacementInspector> from `state.selectedRefs.size`. The one bug this spec
// catches is upstream of both of those: `LayoutDesignerView.persistGeometry`'s
// `new_bin` payload never includes `levels` (see `SavePlacementInput.new_bin.
// levels` in services/supabase/layoutService.ts, which IS wired server-side),
// so a rack's level edits in this designer are pure client state — Save never
// persists them. That's the assertion this spec expects to fail on, and it's
// a genuine product bug, not a selector problem (see the E2E runner's report).
import { expect, loginAsAdmin, test } from '../fixtures/auth'
import { existsWithin, openSettingsWarehouseSubtab } from './helpers'

const TEST_WAREHOUSE_NAME = 'E2E RackLevels Test'
const TEST_WAREHOUSE_CODE = 'E2ERACKLVL'

test.describe('Rack levels — Layout Designer', () => {
  test('override one rack to 4 levels; multi-select apply', async ({ adminPage: page }) => {
    // Many sequential steps (warehouse setup, draft creation, rack generation,
    // a reload-and-reselect round trip) — triple the default timeout rather
    // than race a slow CI/dev box.
    test.slow()
    await openSettingsWarehouseSubtab(page)

    if (!(await existsWithin(page.getByText(TEST_WAREHOUSE_NAME, { exact: true })))) {
      await page.getByRole('button', { name: 'Add warehouse' }).click()
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
      // on the SVG canvas (no per-cell test hooks exist there today). Start
      // well away from (0,0) — helpers.ensureLevelledFixtureRack (run by the
      // putaway-roles/putaway-override/warehouse-tab-live-edit specs) already
      // publishes a permanent rack there, and `locations.code` is globally
      // unique (`${warehouseCode}-B-${x}-${y}`) — generating over it would
      // collide and the save would fail server-side with a real (if
      // self-inflicted) error, not a product bug.
      await page.getByRole('button', { name: /generate racks/i }).click()
      await page.getByLabel('Storage type').selectOption({ label: 'Pallet Rack' })
      await page.getByLabel('Start X').fill('20')
      await page.getByLabel('Start Y').fill('20')
      await page.getByLabel('Columns').fill('3')
      await page.getByLabel('Rows').fill('1')
      await page.getByRole('button', { name: /^Generate 3$/ }).click()

      // Select the first generated rack. Each rack group carries a
      // `data-testid="rack-<code>"` hook (LayoutCanvas.tsx) — clicking it
      // resolves to real screen coordinates, which Playwright turns into a
      // click at that point; the rect itself is `pointerEvents: none` (the
      // transparent interaction layer sits on top and does the real hit
      // testing), so this lands exactly like a real user click would, with
      // no BASE_CELL pixel-math guessing.
      const rack0 = page.getByTestId('rack-E2ERACKLVL-B-20-20')
      const rack1 = page.getByTestId('rack-E2ERACKLVL-B-21-20')
      // `force: true`: the rack <g> is deliberately `pointerEvents: none` (the
      // transparent interaction rect on top does the real hit-testing), so
      // Playwright's own actionability check would otherwise refuse the click
      // as "intercepted". Skipping that check still dispatches a real mouse
      // event at the rack's on-screen coordinates, which the browser then
      // routes to the interaction rect underneath — exactly like a real click.
      await rack0.click({ force: true })
      await expect(page.getByRole('heading', { name: 'Rack', exact: false })).toBeVisible()

      const levelsHeading = page.getByRole('heading', { name: 'Levels' })
      await expect(levelsHeading).toBeVisible({ timeout: 5_000 })
      // NOT page.getByRole('list').getByRole('listitem') — PublishChecklist's
      // 4-item readiness checklist is also a <ul> on this same page, so an
      // unscoped role=list query silently sums both lists' items. The
      // data-testid added to each RackLevelEditor row (level-row-N) is exact.
      await expect(page.getByTestId(/^level-row-/)).toHaveCount(5) // PALLET_RACK standard: 5 levels

      // Override: remove L5 (the bulk level) so this rack has 4, not 5.
      await page.getByRole('button', { name: 'Remove level 5' }).click()
      await expect(page.getByTestId(/^level-row-/)).toHaveCount(4)

      await page.getByRole('button', { name: /^save$/i }).click()
      await expect(page.getByText(/^saved\.?$/i)).toBeVisible({ timeout: 5_000 })

      // Re-login (NOT page.reload() alone — persistSession:false means a
      // plain reload logs the session out; see storage-forms.spec.ts's note).
      await loginAsAdmin(page)
      await openSettingsWarehouseSubtab(page)
      await page.getByRole('button', { name: `Layout designer for ${TEST_WAREHOUSE_NAME}` }).click()
      await page.getByText(/^Layout \d{4}$/).first().click()
      await rack0.click({ force: true })

      // KNOWN PRODUCT BUG (see file header): persistGeometry never forwards
      // `levels` on `new_bin`, so the override never actually persisted — this
      // rack reloads back to its form's standard 5 levels, not the 4 we saved.
      // Soft assertion so the (unrelated) multi-select check below still runs
      // and reports independently in the same pass.
      await expect.soft(page.getByTestId(/^level-row-/)).toHaveCount(4)

      // Multi-select + apply: shift-click a second rack. Both the canvas's
      // additive-select dispatch and the selectedCount → PlacementInspector
      // wiring are confirmed shipped.
      await rack1.click({ modifiers: ['Shift'], force: true })
      await expect(page.getByRole('button', { name: /^Apply this level layout to all \d+ selected racks$/ })).toBeVisible({
        timeout: 5_000,
      })
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
