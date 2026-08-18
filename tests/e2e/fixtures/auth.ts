// Login helper + fixture.
//
// WHY NOT storageState. This block used to say the app ran with
// `persistSession: false`, so there was nothing durable for Playwright to
// snapshot. That reason expired: `lib/auth/inProcessLock.ts` replaced
// supabase-js's `navigatorLock` — which was the actual cause of the Windows
// `getSession()` hang, not the storage — and both `persistSession` and
// `autoRefreshToken` have been ON since the warehouse-onboarding branch.
//
// The CONCLUSION is unchanged, for a different and better reason: a
// storageState snapshot pins a captured access token, and this app now
// refreshes tokens on a rotating refresh token. A replayed state is a state
// that may already have been rotated out from under it, which fails as an
// unexplained mid-spec sign-out rather than as a login error. Driving the real
// login form costs a few seconds per test and cannot go stale.
import { type Page, test as base } from '@playwright/test'
import { getE2eEnv, getE2eWarehouseEnv } from './env'

export interface Credentials {
  email: string
  password: string
}

/** Drives the real login form. Works for any seeded role, not just Admin. */
export async function loginAs(page: Page, { email, password }: Credentials): Promise<void> {
  await page.goto('/')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()

  // Login unmounts <LoginPage> and mounts <AppShell>, which renders a real
  // <nav> sidebar. Wait for that landmark rather than a fixed timeout or a
  // URL change (this is a single-page app with no route change on login).
  await page.getByRole('navigation').first().waitFor({ state: 'visible', timeout: 15_000 })
}

export async function loginAsAdmin(page: Page): Promise<void> {
  const env = getE2eEnv()
  await loginAs(page, { email: env.adminEmail, password: env.adminPassword })
}

export async function loginAsWarehouse(page: Page): Promise<void> {
  const env = getE2eWarehouseEnv()
  await loginAs(page, { email: env.warehouseEmail, password: env.warehousePassword })
}

/**
 * Extended `test` with an `adminPage` fixture: a `page` that is already
 * signed in as the seeded Admin demo account by the time your test body
 * runs. Prefer this over calling `loginAsAdmin` by hand in most specs.
 */
export const test = base.extend<{ adminPage: Page; warehousePage: Page }>({
  // eslint-disable-next-line no-empty-pattern
  adminPage: async ({ page }, use) => {
    await loginAsAdmin(page)
    await use(page)
  },
  /**
   * Signed in as a Warehouse-role account. Used by the `mobile` project, whose
   * whole subject is what the handheld shows the person on the floor.
   *
   * Lazy like every Playwright fixture: a spec that never names
   * `warehousePage` never reads E2E_WAREHOUSE_*, so the desktop suite runs
   * unchanged without them.
   */
  // eslint-disable-next-line no-empty-pattern
  warehousePage: async ({ page }, use) => {
    await loginAsWarehouse(page)
    await use(page)
  },
})

export { expect } from '@playwright/test'
