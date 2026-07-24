// Rack levels — Storage Forms level template editor.
//
// Real UI (components/admin/settings/StorageFormsView.tsx, verified 2026-07-24):
//   - The has_levels opt-in is a `role="switch"` (components/ui/Toggle.tsx),
//     NOT a checkbox — `getByLabel(...).check()` never matches it. Its
//     accessible name is "This form has addressable levels" (not "has
//     levels" — the literal substring the original guessed selector required).
//   - There is no numeric "Levels" count field for the template — levels are
//     added one at a time via an "Add level" button (LevelTemplateEditor).
//   - Each level row exposes `aria-label`s "Role for level N" / "Capacity
//     slots for level N" / "Weight capacity (kg) for level N" / "Remove
//     level N" — no bare "level N role" text as originally guessed.
//
// Uses a dedicated, permanently-named fixture form rather than editing a real
// catalogue form: PALLET_RACK/SHELVING/COLD_ROOM already carry the standard
// template this suite's fixture warehouse rack (helpers.ensureLevelledFixtureRack)
// and putaway-roles/putaway-override depend on, so mutating them here would be
// a footgun for every other spec in the suite. Non-drawable, so it never shows
// up as a paint tool in the Layout Designer.
import { expect, loginAsAdmin, test } from '../fixtures/auth'
import { existsWithin, openSettingsWarehouseSubtab } from './helpers'

const FORM_NAME = 'E2E Level Template Test'
const FORM_CODE = 'E2E_LEVELS'

test.describe('Rack levels — Storage Forms level template', () => {
  test('set a form to 5 levels (L1-4 pick, L5 bulk) and it persists across reload', async ({ adminPage: page }) => {
    await openSettingsWarehouseSubtab(page)
    await expect(page.getByRole('heading', { name: 'Storage forms & capacity' })).toBeVisible()

    if (!(await existsWithin(page.getByText(FORM_NAME, { exact: true })))) {
      await page.getByRole('button', { name: 'Add form' }).click()
      await page.getByLabel('Name', { exact: true }).fill(FORM_NAME)
      await page.getByLabel('Code', { exact: true }).fill(FORM_CODE)
      // Keep this fixture out of the Layout Designer's paint palette.
      await page.getByLabel('Drawable in Layout Designer').uncheck()

      await page.getByRole('switch', { name: 'This form has addressable levels' }).click()
      for (let i = 0; i < 5; i++) {
        await page.getByRole('button', { name: 'Add level' }).click()
      }
      for (const n of [1, 2, 3, 4]) {
        await page.getByLabel(`Role for level ${n}`).selectOption('pick')
      }
      await page.getByLabel('Role for level 5').selectOption('bulk')

      await page.getByRole('button', { name: 'Create form' }).click()
      await expect(page.getByText(/storage form created/i)).toBeVisible({ timeout: 5_000 })
    }

    // Re-login (NOT page.reload() alone — the app runs Supabase with
    // `persistSession: false`, so a plain reload logs the session out and
    // strands the test on <LoginPage>; loginAsAdmin re-navigates to '/' and
    // signs back in) and confirm the level template round-tripped through
    // the DB rather than only living in component state.
    await loginAsAdmin(page)
    await openSettingsWarehouseSubtab(page)
    await page.getByRole('button', { name: `Edit ${FORM_NAME}`, exact: true }).click()

    await expect(page.getByRole('switch', { name: 'This form has addressable levels' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.getByLabel('Role for level 1')).toHaveValue('pick')
    await expect(page.getByLabel('Role for level 4')).toHaveValue('pick')
    await expect(page.getByLabel('Role for level 5')).toHaveValue('bulk')
  })
})
