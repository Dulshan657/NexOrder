// Does a session survive a shift? — KNOWN-ERRORS-REGISTER.md O6.
//
// ── WHAT IS ACTUALLY IN DOUBT ───────────────────────────────────────────────
//
// `lib/auth/inProcessLock.ts` replaced supabase-js's `navigatorLock`, which
// never resolved on Windows, and that is what allowed `persistSession` and
// `autoRefreshToken` to be turned back on. Every auth operation — including the
// token refresh — now serialises on a promise chain in that file. If that chain
// can deadlock, or if a rotating refresh token can lose a race with itself, the
// symptom is not an error: it is an operator being signed out mid-shift, which
// is the exact failure the change was made to end.
//
// The register's stated procedure was "leave a handheld logged in for 90
// minutes and come back". Nobody ever did, which is why O6 sat open for months
// with an instrument (`lib/auth/sessionBreadcrumbs.ts`) and no result.
//
// ── WHY THIS TAKES TWELVE MINUTES AND NOT NINETY ────────────────────────────
//
// supabase-js renews when the token expires within
// `AUTO_REFRESH_TICK_THRESHOLD (3) × AUTO_REFRESH_TICK_DURATION_MS (30s)` — 90
// SECONDS, not the ten minutes this repo believed until 2026-08-19. So the wait
// is a function of the token's lifetime, and the lifetime is a project setting.
// `scripts/session-soak.mjs` drops dev's `jwt_exp` to 300s for the duration,
// which turns "one refresh in ninety minutes" into "three in twelve".
//
// ── WHAT THIS DOES *NOT* PROVE ──────────────────────────────────────────────
//
// This is Chromium on a desktop. It is not a CipherLab RS35, and it is not
// Android's tab-discard behaviour. It proves the mechanism — lock, refresh,
// rotation, persistence — over repeated cycles. The device-specific half of O6
// still wants a handheld.
import { expect, test } from '@playwright/test'
import { loginAsAdmin } from '../e2e/fixtures/auth'

/** Where `lib/auth/sessionBreadcrumbs.ts` writes. */
const BREADCRUMB_KEY = 'nexorder.auth.breadcrumbs'

/** How many full refresh cycles to sit through. */
const CYCLES = 3

/**
 * The ceiling this refuses to run above.
 *
 * A one-hour token means the first refresh is ~58 minutes away, which no
 * reasonable test timeout covers — and a spec that merely times out reads as a
 * product failure rather than as "you ran me wrong". Anything at or under this
 * is a deliberately shortened lifetime.
 */
const MAX_SENSIBLE_LIFETIME_MS = 15 * 60_000

interface Breadcrumbs {
  signedInAt: number | null
  refreshCount: number
  refreshes: number[]
  expiresAt: number | null
}

async function readBreadcrumbs(page: import('@playwright/test').Page): Promise<Breadcrumbs> {
  const raw = await page.evaluate(key => window.localStorage.getItem(key), BREADCRUMB_KEY)
  expect(raw, 'no session breadcrumbs — did the sign-in take?').not.toBeNull()
  return JSON.parse(raw as string) as Breadcrumbs
}

/**
 * The access token supabase-js is currently holding.
 *
 * Read out of ITS storage, not out of the breadcrumbs, which deliberately carry
 * no credential. The key is `sb-<project-ref>-auth-token`, and the ref is
 * whichever project the deployment points at — so it is matched by shape rather
 * than named, which also keeps this working against a local dev server.
 */
async function readAccessToken(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null')
        if (parsed?.access_token) return parsed.access_token as string
      } catch {
        // Not the shape we are after; keep looking.
      }
    }
    return null
  })
  expect(token, 'supabase-js is holding no access token').not.toBeNull()
  return token as string
}

test.describe('session survives a shift (O6)', () => {
  test('the token refreshes repeatedly and the session is never dropped', async ({ page }) => {
    test.setTimeout(20 * 60_000)

    await loginAsAdmin(page)

    const first = await readBreadcrumbs(page)
    expect(first.signedInAt, 'sign-in was not recorded').not.toBeNull()
    expect(first.expiresAt, 'no token expiry was recorded').not.toBeNull()

    const lifetimeMs = (first.expiresAt as number) - (first.signedInAt as number)
    // Fail here rather than time out silently twelve minutes from now. The
    // difference matters: a timeout looks like the app is broken, and this is
    // the harness telling you it was invoked wrong.
    expect(
      lifetimeMs,
      `This session's token lasts ${Math.round(lifetimeMs / 60_000)} minutes. The soak ` +
        'shortens it first — run `npm run soak:session:dev`, which lowers the dev ' +
        "project's jwt_exp for the duration and restores it afterwards.",
    ).toBeLessThanOrEqual(MAX_SENSIBLE_LIFETIME_MS)

    const tokenAtStart = await readAccessToken(page)
    const signedInAt = first.signedInAt as number

    // A fresh session starts at zero. Anything else means we inherited a
    // session and are about to measure the wrong one.
    expect(first.refreshCount, 'expected a fresh session').toBe(0)

    // Sit through the cycles. Poll rather than sleep-then-assert so a failure
    // says WHICH cycle stalled, and so the log shows progress on a run this
    // long. The margin is 90s before expiry, so a cycle is (lifetime - 90s),
    // plus a tick's slack because the check only runs every 30 seconds.
    const cycleMs = lifetimeMs - 90_000 + 45_000
    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      await expect
        .poll(
          async () => (await readBreadcrumbs(page)).refreshCount,
          {
            message: `token refresh #${cycle} never happened — this is the O6 failure`,
            timeout: cycleMs + 90_000,
            intervals: [10_000],
          },
        )
        .toBeGreaterThanOrEqual(cycle)

      const now = await readBreadcrumbs(page)
      // A reset start time means a SIGNED_IN fired, i.e. the session was
      // dropped and re-established. That is the failure wearing the costume of
      // a pass, and it is invisible in the refresh count alone.
      expect(now.signedInAt, `signed out and back in before refresh #${cycle}`).toBe(signedInAt)
      console.log(
        `refresh ${now.refreshCount} at +${Math.round((Date.now() - signedInAt) / 1000)}s, ` +
          `expires in ${Math.round(((now.expiresAt ?? 0) - Date.now()) / 1000)}s`,
      )
    }

    const end = await readBreadcrumbs(page)
    expect(end.refreshCount).toBeGreaterThanOrEqual(CYCLES)

    // The renewals were real renewals, not the same token re-recorded.
    expect(await readAccessToken(page), 'the access token never actually changed').not.toBe(
      tokenAtStart,
    )

    // The gaps look like renewals against THIS lifetime rather than a burst.
    // One refresh could be `_recoverAndRefresh` on load; three at the right
    // spacing could not.
    const gaps = end.refreshes.slice(1).map((at, i) => at - end.refreshes[i])
    for (const gap of gaps) {
      expect(gap, `refresh gap of ${Math.round(gap / 1000)}s against a ${Math.round(lifetimeMs / 1000)}s token`)
        .toBeGreaterThan(lifetimeMs / 2)
    }

    // And finally the thing an operator would actually do: come back and use
    // it. A counter going up is not the claim — "come back and scan" is. This
    // needs a live token, so a silently-dead session fails here even if every
    // assertion above passed.
    await page.getByRole('button', { name: 'Warehouse', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Warehouse', exact: true })).toBeVisible({
      timeout: 20_000,
    })
  })
})
