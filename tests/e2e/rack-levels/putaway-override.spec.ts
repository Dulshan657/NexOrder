// Rack levels — the manual override path (role-mismatch warning + "Place
// anyway").
//
// Depends on: migration 00072 (not yet applied) AND at least one queued
// putaway line whose only recommended bins are role-mismatched for its SKU.
// Unlike the other specs in this suite, the UI THIS TEST DRIVES IS ALREADY
// FULLY BUILT (confirmed by reading source, 2026-07-24):
//   - components/inventory/putaway/PutawayRow.tsx — amber "Choose bin" +
//     amber mismatch label sourced straight from the engine's hard-filter
//     reason (row.explanation.hardFilters, code LEVEL_ROLE_MISMATCH).
//   - components/inventory/putaway/BinPickerSheet.tsx — a mismatched bin in
//     the browse list is tagged "{role} level"; picking one turns the confirm
//     button into amber "Place anyway" and shows the audit-record notice.
// It simply has no data to exercise yet: there is no levelled bin in any
// warehouse today, so the queue never wedges on LEVEL_ROLE_MISMATCH and
// nothing in this spec can be reached. This is the strongest signal in the
// whole suite that the FRONTEND is ready and waiting on the DB migration +
// a converted warehouse.
import { expect, test } from '../fixtures/auth'
import { openPutawayQueue } from './helpers'

test.describe('Rack levels — putaway override [frontend SHIPPED, blocked on mig 00072 + a levelled warehouse with no free compatible level]', () => {
  test('a role-mismatched queue line shows the warning and "Place anyway" succeeds', async ({ adminPage: page }) => {
    await openPutawayQueue(page)

    // Find a row whose "Choose bin" affordance is in its amber (mismatched)
    // state — PutawayRow.tsx renders it with `border-amber-300 bg-amber-50
    // text-amber-700` only when `mismatch` (a LEVEL_ROLE_MISMATCH hard filter)
    // is present on that row's explanation.
    const mismatchedRow = page.locator('button', { hasText: 'Choose bin' }).and(page.locator('.text-amber-700'))
    await expect(mismatchedRow.first()).toBeVisible({ timeout: 5_000 })
    await mismatchedRow.first().click()

    // BinPickerSheet: real selectors.
    await expect(page.getByText('Choose a bin')).toBeVisible()
    await page.getByLabel('Search bins').fill('') // browse the full list
    const mismatchedBinButton = page.getByText(/level$/).first() // "{role} level" badge
    await mismatchedBinButton.click()

    await expect(page.getByText(/this is the engine's hard rule/i)).toBeVisible()
    await page.getByRole('button', { name: 'Place anyway' }).click()

    // The override is recorded server-side (audit_events, per mig 00072's
    // decide-putaway `role_override: true` handling) — the row should clear
    // from the queue on success.
    await expect(mismatchedRow.first()).toHaveCount(0, { timeout: 10_000 })
  })
})
