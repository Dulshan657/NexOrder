// Rack levels — a pick task names the LEVEL, not just the rack.
//
// Depends on: migration 00072 + a converted, levelled rack actually holding
// allocated stock against an open order. Per the approved plan, this needs
// NO component change once the data exists — `wie_order_alloc_bins` (mig
// 00064) is keyed on (product, location), and a levelled rack simply
// contributes N co-located locations (its levels) instead of one, so
// `PickTask.code` (rendered as-is in PickWorkspaceModal.tsx's
// `<PickTaskRow>`) should already show e.g. `MAIN-B-4-2-L2` the moment a
// pick task resolves to a level location. That data doesn't exist yet, so
// today every `task.code` is a bare rack/bin code.
import { expect, test } from '../fixtures/auth'
import { openPickQueue } from './helpers'

test.describe('Rack levels — pick task naming [NOT YET SHIPPED, depends on mig 00072 + a converted rack with allocated stock]', () => {
  test('an order allocated to a levelled rack shows a per-level pick task code', async ({ adminPage: page }) => {
    await openPickQueue(page)

    // PickTaskRow renders `task.code` as a plain text span next to a MapPin
    // icon (components/inventory/PickWorkspaceModal.tsx). Open the first
    // order's pick workspace and look for a level-suffixed code.
    const firstOrderRow = page.getByRole('button').filter({ hasText: /ready to pick/i }).first()
    if (await firstOrderRow.count()) {
      await firstOrderRow.click()
    }

    await expect(page.getByText(/-L\d+$/)).toBeVisible({ timeout: 5_000 })
  })
})
