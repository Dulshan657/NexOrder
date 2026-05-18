// Playwright E2E skeleton for the PO Inbox flow.
//
// This file is intentionally NOT named *.spec.ts so it doesn't get
// picked up by a Playwright runner before the prerequisites are met.
// Rename to .spec.ts once you have:
//   1. @playwright/test installed
//   2. A dedicated test Gmail account whose OAuth refresh token is
//      seeded into the test environment as TEST_GMAIL_REFRESH_TOKEN
//   3. An Admin user seeded as ADMIN_TEST_EMAIL with password
//      ADMIN_TEST_PASSWORD
//
// Replace the `test` imports with `@playwright/test` once installed.

/* eslint-disable @typescript-eslint/no-unused-vars */
// import { test, expect } from '@playwright/test'

// Sentinel so this file fails fast if a runner picks it up before
// renaming:
throw new Error(
  'po-inbox.spec.skeleton.ts is a starting template. Rename to *.spec.ts ' +
  'and install @playwright/test before running.',
)

// Sketched scenarios — implement on Phase 2:

/*
test.describe('PO Inbox end-to-end', () => {
  test.beforeEach(async ({ page, context }) => {
    // Sign in as Admin via the existing auth UI; or inject a Supabase
    // session token via context.addInitScript so we skip the auth UI.
    await page.goto(process.env.TEST_BASE_URL ?? 'http://localhost:3000')
    await page.fill('[data-test=login-email]', process.env.ADMIN_TEST_EMAIL!)
    await page.fill('[data-test=login-password]', process.env.ADMIN_TEST_PASSWORD!)
    await page.click('[data-test=login-submit]')
    await page.waitForURL('**\/admin\/**')
  })

  test('connect Gmail → see new mailbox listed', async ({ page }) => {
    await page.goto('/admin/email-accounts')
    // OAuth round-trips through Google; for the E2E we substitute the
    // refresh token directly via supabase.functions.invoke on the
    // gmail-oauth-callback endpoint with a synthesized auth code.
    // Verify the row appears in the Email Accounts table.
    await expect(page.locator('[data-test=email-account-row]')).toHaveCount(1)
  })

  test('drop a PO email → see it in PO Inbox within 90s', async ({ page, request }) => {
    // Trigger poll-inbox manually via REST so we don't wait on the cron tick.
    await request.post(`${process.env.SUPABASE_URL}/functions/v1/poll-inbox`, {
      headers: { Authorization: `Bearer ${process.env.POLL_INBOX_CRON_TOKEN!}` },
      data: {},
    })
    await page.goto('/admin/po-inbox')
    await expect(page.locator('[data-test=po-inbox-row]').first()).toBeVisible({ timeout: 90_000 })
  })

  test('approve a pending PO → order appears in /admin/orders', async ({ page }) => {
    await page.goto('/admin/po-inbox')
    await page.locator('[data-test=po-inbox-row]').first().click()
    await page.locator('[data-test=customer-select]').selectOption({ index: 1 })
    await page.locator('[data-test=line-product-0]').selectOption({ index: 1 })
    await page.click('[data-test=approve-button]')
    await expect(page.locator('text=Order .* created')).toBeVisible({ timeout: 10_000 })

    await page.goto('/admin/orders')
    await expect(page.locator('[data-test=order-source=email_inbound]').first()).toBeVisible()
  })

  test('reject a pending PO → marked rejected', async ({ page }) => {
    await page.goto('/admin/po-inbox')
    await page.locator('[data-test=po-inbox-row]').first().click()
    await page.click('[data-test=reject-toggle]')
    await page.fill('[data-test=rejection-reason]', 'Test rejection from E2E suite')
    await page.click('[data-test=reject-confirm]')

    // The row should disappear from Needs Review and reappear under Rejected.
    await page.click('[data-test=tab-rejected]')
    await expect(page.locator('[data-test=po-inbox-row]').first()).toBeVisible()
  })
})
*/
