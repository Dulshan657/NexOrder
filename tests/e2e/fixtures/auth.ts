// Login helper + fixture.
//
// WHY NOT storageState: the app's Supabase client runs with
// `persistSession: false` (lib/supabase.ts) — enabling persistence (either
// localStorage or sessionStorage) made `getSession()` hang indefinitely on
// Windows, so the team turned it off and accepted "re-login after a tab
// close" as the tradeoff (see CLAUDE.md gotchas). Practically, that means
// there is nothing durable in localStorage/sessionStorage/cookies after a
// successful sign-in for Playwright's `storageState` mechanism to snapshot
// and replay — a brand new page load always renders <LoginPage>, full stop.
// A `storageState` fixture here would silently degrade to "always shows the
// login form" and every spec would then need the login helper anyway, so we
// skip the indirection and drive the real login form once per test instead.
// It costs a few seconds per test; correctness > speed for a suite this size.
import { type Page, test as base } from '@playwright/test'
import { getE2eEnv } from './env'

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

/**
 * Extended `test` with an `adminPage` fixture: a `page` that is already
 * signed in as the seeded Admin demo account by the time your test body
 * runs. Prefer this over calling `loginAsAdmin` by hand in most specs.
 */
export const test = base.extend<{ adminPage: Page }>({
  // eslint-disable-next-line no-empty-pattern
  adminPage: async ({ page }, use) => {
    await loginAsAdmin(page)
    await use(page)
  },
})

export { expect } from '@playwright/test'
