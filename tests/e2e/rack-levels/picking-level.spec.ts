// Rack levels — a pick task names the LEVEL, not just the rack.
//
// Per the approved plan, this needs NO component change once the data
// exists — `wie_order_alloc_bins` (mig 00064) is keyed on (product, location),
// and a levelled rack simply contributes N co-located locations (its levels)
// instead of one, so `PickTask.code` (rendered as-is in PickWorkspaceModal.tsx's
// `<PickTaskRow>`, confirmed 2026-07-24) should already show e.g.
// `E2ERACKLVL-B-0-0-L2` the moment a pick task resolves to a level location.
//
// DATA / INFRASTRUCTURE PRECONDITION this suite cannot fabricate cheaply: an
// order has to be ALLOCATED against the fixture rack specifically. Order
// fulfilment warehouse routing (`_shared/warehouseRouting.ts`
// `orderedWarehousesFor`) is closest-first by the HoReCa's lat/lng, falling
// back to warehouses with no coordinates (sorted by id) only once every
// closer, stocked warehouse is exhausted — reliably forcing it onto the
// fixture warehouse would mean either (a) giving the fixture warehouse
// coordinates and a dedicated product with provably zero stock everywhere
// else, then driving the full place-order → admin-processing → pick-queue
// lifecycle through the Shop UI, none of which this suite has built out or
// verified yet, or (b) a direct SQL fixture, which is out of scope for an E2E
// harness. Until one of those exists, this spec documents the target
// behaviour and is expected to fail at the final assertion — that failure is
// a missing precondition, not a product bug: MAIN has no converted rack and
// the fixture warehouse carries no customer-facing order stock.
import { expect, test } from '../fixtures/auth'
import { openPickQueue } from './helpers'

test.describe('Rack levels — pick task naming', () => {
  test('an order allocated to a levelled rack shows a per-level pick task code', async ({ adminPage: page }) => {
    await openPickQueue(page)

    const firstOrderRow = page.getByRole('button').filter({ hasText: /ready to pick/i }).first()
    if (await firstOrderRow.count()) {
      await firstOrderRow.click()
    }

    await expect(page.getByText(/-L\d+$/)).toBeVisible({ timeout: 5_000 })
  })
})
