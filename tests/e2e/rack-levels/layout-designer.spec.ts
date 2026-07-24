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
// <PlacementInspector> from `state.selectedRefs.size`.
//
// FIXED 2026-07-24 (commit d17a2e8): `LayoutDesignerView.persistGeometry` now
// threads `p.levels` into its `new_bin` payload and marks the bin `kind:
// 'RACK'` when it carries levels (the server rejects `levels` unless kind is
// RACK). CONFIRMED via a direct read of `locations` after Save (bypassing the
// UI entirely): the override genuinely reaches the database now — a rack
// with L5 removed persists as exactly 4 SHELF rows (L1-L4), not 5.
//
// FIXED 2026-07-24 (commit b847fc3), re-verified in this pass:
//
// 1. Reload now shows the persisted override. `useLayoutEditorState.ts`'s
//    `load` reducer regroups co-located level rows onto their RACK parent
//    (keyed by `parentId` off the now-widened `codeByLocation` map) and
//    rebuilds `placement.levels[]` from them, so the Level editor reads the
//    real 4 rows back after a Save + re-login + reload round trip instead of
//    falling back to the form's standard 5-level template. Cross-checked
//    against a direct `locations` read in the same session (see the E2E
//    runner's report) — the reloaded UI count matches the DB row count.
//
// 2. Multi-select works again once the first rack is a real (persisted)
//    levelled rack. `LayoutCanvas.tsx`'s expand-in-place scrim now checks
//    `e.shiftKey || e.ctrlKey || e.metaKey` before collapsing, and on a
//    modifier-click resolves the placement under the pointer and dispatches
//    `{type:'select', ref: hit.clientRef, additive: true}` instead — so
//    shift-clicking rack1 while rack0 is expanded ADDS rack1 to the
//    selection (asserted as an exact "2 selected racks" count below) rather
//    than collapsing rack0's expansion.
//
// FIXED 2026-07-24 (commit b847fc3), re-verified in this pass:
// `mutate-layout`'s `delete_layout` GC step now sorts the draft-only
// locations it's about to delete by `materialized_path` length descending
// (deepest/child rows first) before deleting, so a levelled rack's SHELF
// children are gone before its RACK parent's turn comes up — no more FK
// violation on the self-referential `parent_id`, and the delete's `.error`
// is now checked and surfaced instead of swallowed. A fixed start cell would
// still only work once against the ACCUMULATED PRE-FIX orphans already
// sitting in prod from earlier (broken) runs of this spec — see the E2E
// runner's report for the exact before/after orphan counts — so this spec
// keeps its randomised start cell (below) rather than assume those are gone.
import { expect, loginAsAdmin, test } from '../fixtures/auth'
import { existsWithin, openSettingsWarehouseSubtab } from './helpers'

const TEST_WAREHOUSE_NAME = 'E2E RackLevels Test'
const TEST_WAREHOUSE_CODE = 'E2ERACKLVL'

// Randomised start cell, NOT a fixed one: `mutate-layout`'s delete_layout GC
// now deletes deepest-first (commit b847fc3) so a normal run of this spec no
// longer orphans its RACK parent — but ~26 orphaned RACK rows already
// accumulated in prod from pre-fix runs (their codes are still squatted,
// `locations.code` being globally unique), so a fixed cell would still
// collide with one of those. 0-54 keeps 3 columns inside the default
// 60-wide grid; 0-35 keeps 1 row inside the default 40-tall grid.
const START_X = Math.floor(Math.random() * 55)
const START_Y = Math.floor(Math.random() * 36)
// Logged so a failure/flake can be correlated back to the exact locations it
// touched via a direct DB read (see the E2E runner's report).
// eslint-disable-next-line no-console
console.log(`[layout-designer.spec] START_X=${START_X} START_Y=${START_Y}`)

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
      await page.getByLabel('Start X').fill(String(START_X))
      await page.getByLabel('Start Y').fill(String(START_Y))
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
      //
      // Regex, not an exact code: pre-save, a draft rack is ONE placement
      // with an embedded `levels` array, so its testid is the bare rack code
      // ("rack-E2ERACKLVL-B-<x>-<y>"). Once persistGeometry actually persists
      // the level override (the fix verified below), Save creates a REAL
      // RACK parent + one SHELF placement per level server-side; after
      // reload, `groupPlacementsByCell` groups those N rows into one rack
      // group keyed off its FIRST item, which now carries a per-level code
      // ("rack-E2ERACKLVL-B-<x>-<y>-L1") instead of the bare one. Both forms
      // are the same rack; match either.
      const rack0 = page.getByTestId(new RegExp(`^rack-E2ERACKLVL-B-${START_X}-${START_Y}(-L\\d+)?$`))
      const rack1 = page.getByTestId(new RegExp(`^rack-E2ERACKLVL-B-${START_X + 1}-${START_Y}(-L\\d+)?$`))
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

      // FIXED 2026-07-24 (commit b847fc3): useLayoutEditorState's `load` now
      // regroups co-located level rows onto their RACK parent and rebuilds
      // `placement.levels[]`, so the reloaded Level editor reads the real
      // persisted override (4 rows) instead of falling back to the form's
      // standard 5-level template. Hard assertion (was `expect.soft` while
      // this was a known gap).
      await expect(page.getByTestId(/^level-row-/)).toHaveCount(4)

      // FIXED 2026-07-24 (commit b847fc3): LayoutCanvas's expand-in-place
      // scrim now forwards a modifier-click to the additive-select path
      // (dispatching `{type:'select', ref: hit.clientRef, additive: true}`)
      // instead of unconditionally collapsing, so shift-clicking rack1 while
      // rack0 is expanded ADDS rack1 to the selection rather than collapsing
      // rack0. Assert the exact count (2), not just that the button appears,
      // so a regression back to "collapses to 1" or "no-ops to 0" is caught.
      await rack1.click({ modifiers: ['Shift'], force: true })
      await expect(page.getByRole('button', { name: 'Apply this level layout to all 2 selected racks' })).toBeVisible({
        timeout: 5_000,
      })
    } finally {
      // Best-effort cleanup: delete the draft we created so repeated runs
      // don't accumulate throwaway layouts against the fixture warehouse.
      //
      // Scoped to the CURRENTLY SELECTED chip (`.border-emerald-500` — see
      // LayoutDesignerView.tsx's `selected` class), not `.first()` on every
      // "Delete Layout 2026" button — a `.first()` picks whichever draft
      // happens to render first in the list, which is a DIFFERENT (and
      // possibly leftover) draft the moment more than one exists. Our own
      // draft stays selected (`selectedLayoutId`) the whole way through this
      // test, so its chip is always the emerald one.
      const ownChip = page.locator('div.border-emerald-500', { hasText: 'draft' })
      const deleteDraft = ownChip.getByRole('button', { name: /^Delete Layout \d{4}$/ })
      if (await deleteDraft.count()) {
        await deleteDraft.click()
        await page.getByRole('button', { name: 'Confirm delete' }).click()
        // The confirm button disables mid-mutation then the whole chip is
        // removed from the DOM on success — wait for that rather than a
        // fixed delay so a slow delete (it also GCs draft-only locations)
        // can't race the test's own teardown.
        await expect(ownChip).toHaveCount(0, { timeout: 10_000 })
      }
    }
  })
})
