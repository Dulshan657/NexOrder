// NX-0008 — the Admin Dashboard's "this month" numbers, end to end.
//
// Signs in as Admin through the real login form, reads what the dashboard
// actually renders (the Orders KPI, each order-pipeline stage and the cancelled
// line) and checks every figure against SQL run on the same database
// (__tests__/support/orderNumbersSql.ts, written independently of the app).
// __tests__/numbersParity.integration.test.ts checks Nex's tool against the same
// SQL, so a pass of both means the screen and Nex say the same thing.
//
// Read-only. Needs E2E_ADMIN_* AND dev database credentials (.env.dev.local);
// without them it fails loudly rather than skipping. Point E2E_BASE_URL at the dev
// deployment or a local `npm run dev`; the config refuses a tenant origin.

import type pg from 'pg'
import { expect, test } from './fixtures/auth'
import { withRollbackTx } from '../../__tests__/support/pgTestClient'
import { sqlTruth, type SqlTruth } from '../../__tests__/support/orderNumbersSql'

async function readTruth(): Promise<SqlTruth> {
  let truth: SqlTruth | null = null
  await withRollbackTx(async (client: pg.Client) => {
    truth = await sqlTruth(client)
  })
  if (!truth) throw new Error('SQL truth was not computed')
  return truth
}

test.describe('order numbers on the Admin Dashboard', () => {
  test('This month: Orders KPI, pipeline stages and cancelled line match SQL', async ({ adminPage: page }) => {
    const truth = await readTruth()

    // The dashboard opens on This Month for both the KPIs and the pipeline card.
    await expect(page.getByRole('button', { name: 'This Month', exact: true })).toBeVisible()

    const ordersCard = page.locator('button', { has: page.getByText('Orders', { exact: true }) }).first()
    await expect(ordersCard.locator('p').first()).toHaveText(String(truth.placed))

    await expect(page.getByRole('heading', { name: /order pipeline/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'This month', exact: true })).toHaveAttribute('aria-pressed', 'true')

    const counts = page.getByRole('list', { name: 'Order pipeline counts' })
    for (const status of ['processing', 'processed', 'picked', 'packed', 'dispatched', 'delivered']) {
      const expected = truth.placedByStatus[status] ?? 0
      await expect(counts.locator(`li[data-status="${status}"]`)).toHaveText(new RegExp(`: ${expected}$`))
    }
    // The stored 'processed' status is shown as Confirmed, never "Processed".
    await expect(counts.locator('li[data-status="processed"]')).toHaveText(/^Confirmed:/)

    if (truth.cancelled > 0) {
      await expect(page.getByText(`${truth.cancelled} cancelled in this period`)).toBeVisible()
    } else {
      await expect(page.getByText(/cancelled in this period/)).toHaveCount(0)
    }
  })
})
