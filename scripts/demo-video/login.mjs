// scripts/demo-video/login.mjs
//
// Pre-roll: navigate, sign in as the demo Admin, land on PO Inbox. Runs
// BEFORE the screencast starts (see record.mjs) so the login screen never
// appears in either cut — the video should open already inside the app.

import { DEMO_ADMIN } from './config.mjs'
import { dismissToasts } from './interact.mjs'

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 */
export async function loginAndOpenPoInbox(page, baseUrl) {
  // ?tab= is read once by AppShell's useState initializer, at the moment it
  // first mounts (i.e. right after sign-in) — see lib/adminTabUrl.ts and
  // AppShell.tsx's adminView useState initializer. Setting it before login
  // means the app lands straight on PO Inbox with no extra navigation once
  // authenticated, and no navigation means no extra page load to hide.
  await page.goto(`${baseUrl}/?tab=${encodeURIComponent('PO Inbox')}`, { waitUntil: 'domcontentloaded' })

  // Demo host only (LoginPage.tsx SHOW_DEMO_LOGINS / __DEMO_HOST__) — the
  // click-to-fill chip sets email + password but does not submit.
  const adminChip = page.getByRole('button', {
    name: new RegExp(`Fill the form with the ${DEMO_ADMIN.role} account`, 'i'),
  })
  await adminChip.waitFor({ state: 'visible', timeout: 30_000 })
  await adminChip.click()

  const signInButton = page.getByRole('button', { name: /^Sign in$/ })
  await signInButton.click()

  // PO Inbox's status-filter nav is the first thing that renders once the
  // tab is live — a stable, role-free anchor that doesn't depend on which
  // status tab ends up selected or whether the queue is empty.
  await page.locator('nav[aria-label="PO status filter"]').waitFor({ state: 'visible', timeout: 30_000 })

  // Sign-in fires low-stock toasts a moment later; clear them before the
  // camera starts so the video does not open on three warnings.
  await page.waitForTimeout(3500)
  await dismissToasts(page)
}
