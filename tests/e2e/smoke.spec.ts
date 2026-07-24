// Harness smoke test. This is the "is the harness itself alive" check —
// keep it independent of any in-flight feature so it stays green while
// other suites (e.g. tests/e2e/rack-levels/**) are expected to fail because
// the feature they cover hasn't shipped yet.
import { expect, test } from './fixtures/auth'

test.describe('E2E harness smoke test', () => {
  test('login as Admin, app loads, Warehouse tab navigates', async ({ adminPage: page }) => {
    // adminPage fixture already completed a real sign-in via the login form.
    await expect(page.getByRole('navigation').first()).toBeVisible()

    // Sidebar nav button, not the "Stock" item (same icon family, different
    // label) — exact match avoids collisions.
    await page.getByRole('button', { name: 'Warehouse', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Warehouse', exact: true })).toBeVisible()
  })
})
