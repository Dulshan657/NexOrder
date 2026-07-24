// Rack levels — Storage Forms level template editor.
//
// Depends on: migration 00072 (storage_types.has_levels / level_template) and
// the StorageFormsView UI wiring described in
// ~/.claude/plans/warehouse-tab-after-clicking-floofy-bumblebee.md
// ("UI wiring" table: `components/admin/settings/StorageFormsView.tsx` gains
// a has_levels toggle + standard level-template editor per form).
//
// NONE of this exists on disk yet (verified: StorageFormsView.tsx today only
// has flat "Levels" / "Positions / level" capacity fields, no role concept).
// These tests are expected to FAIL until that ships — that failure is the
// point: it is the executable spec other agents are building against.
//
// Selectors below are best-effort guesses at the eventual UI, based on the
// plan's own vocabulary ("has_levels toggle", level `role` enum
// pick|reserve|bulk). See the final report for the data-testid list this
// suite would like the app agents to add so it stops depending on wording.
import { expect, test } from '../fixtures/auth'
import { openSettingsWarehouseSubtab } from './helpers'

test.describe('Rack levels — Storage Forms level template [NOT YET SHIPPED, depends on mig 00072]', () => {
  test('set Pallet Rack to 5 levels (L1-L4 pick, L5 bulk) and it persists across reload', async ({ adminPage: page }) => {
    await openSettingsWarehouseSubtab(page)
    await expect(page.getByRole('heading', { name: 'Storage forms & capacity' })).toBeVisible()

    // StorageFormsView labels its edit button aria-label={`Edit ${t.name}`}.
    await page.getByRole('button', { name: 'Edit Pallet Rack', exact: true }).click({ timeout: 5_000 })

    // --- Speculative: has_levels opt-in + per-level role template. ---
    await page.getByLabel(/has levels/i).check({ timeout: 5_000 })
    await page.getByLabel(/^levels$/i).fill('5')

    for (const n of [1, 2, 3, 4]) {
      await page.getByLabel(new RegExp(`level ${n} role`, 'i')).selectOption('pick')
    }
    await page.getByLabel(/level 5 role/i).selectOption('bulk')

    await page.getByRole('button', { name: /save/i }).click()
    await expect(page.getByText(/storage form saved/i)).toBeVisible({ timeout: 5_000 })

    // Reload and confirm the level template round-tripped through the DB
    // rather than only living in component state.
    await page.reload()
    await openSettingsWarehouseSubtab(page)
    await page.getByRole('button', { name: 'Edit Pallet Rack', exact: true }).click()

    await expect(page.getByLabel(/^levels$/i)).toHaveValue('5')
    await expect(page.getByLabel(/level 1 role/i)).toHaveValue('pick')
    await expect(page.getByLabel(/level 5 role/i)).toHaveValue('bulk')
  })
})
