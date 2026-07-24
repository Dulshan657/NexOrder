// Rack levels — putaway respects a SKU's allowed level roles.
//
// Depends on: migration 00072 (verified NOT applied to prod as of writing —
// `product_wms_attributes` has no `allowed_level_roles` column) AND at least
// one real levelled bin (bulk + pick roles) existing in the warehouse this
// receipt lands in. Today NEITHER exists — but the SKU-side setup below
// (ProductWmsAttributesSection's "Allowed level roles" fieldset) is REAL,
// already-shipped UI (confirmed by reading
// components/admin/ProductWmsAttributesSection.tsx), so that half of this
// test documents behaviour that may already work once the migration lands,
// even before any bin is levelled.
//
// This test edits a real catalogue product's WMS attributes (a prod write).
// The restore-to-original-state step runs immediately after the assertion,
// in the SAME product-edit session (never navigating away first) — an
// earlier draft of this spec navigated to Receiving before restoring and the
// cleanup then timed out against an unmounted form. Keep it this way.
import { expect, test } from '../fixtures/auth'

test.describe('Rack levels — putaway role gate [NOT YET SHIPPED, depends on mig 00072 + a levelled warehouse]', () => {
  test('checking "bulk" on a product\'s allowed level roles persists (and is restored after)', async ({ adminPage: page }) => {
    await page.getByRole('button', { name: 'Products', exact: true }).click()
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click()

    // Real, shipped selectors (ProductWmsAttributesSection.tsx):
    //   <fieldset><legend>Allowed level roles</legend> + <label>bulk<input type=checkbox></label> ...
    await expect(page.getByText('Allowed level roles')).toBeVisible()
    const bulkCheckbox = page.getByLabel('bulk', { exact: true })
    const wasChecked = await bulkCheckbox.isChecked()

    try {
      if (!wasChecked) await bulkCheckbox.check()
      await page.getByRole('button', { name: /save attributes/i }).click()
      await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5_000 })

      // The rest of the flow (receive a pallet-scale line for this now
      // bulk-only SKU, confirm the Putaway queue recommends a bulk-role
      // level) needs a real levelled bin, which doesn't exist anywhere yet.
      // This is the line that documents the target behaviour and is
      // expected to fail until mig 00072 + a converted warehouse exist:
      await expect(page.getByText(/-L5\b/)).toBeVisible({ timeout: 5_000 }) // e.g. MAIN-B-x-y-L5 (bulk)
    } finally {
      // Restore BEFORE navigating anywhere else, in the same session that
      // made the change, so cleanup can't be stranded by a later navigation.
      if (!wasChecked && (await bulkCheckbox.count())) {
        await bulkCheckbox.uncheck()
        await page.getByRole('button', { name: /save attributes/i }).click()
        await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5_000 })
      }
    }
  })
})
