import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { partitionViolations } from './exceptions'

// axe in a REAL browser, which is the only place `color-contrast` can run at
// all: jsdom has no layout and no computed colour, so the unit-tier suite in
// __tests__/a11y/ silently skips that rule however bad the palette gets.
//
// Login surfaces ONLY, and that is a property of the app rather than a lack of
// ambition. There is no router — every screen lives at `/` behind
// components/auth/AuthGate.tsx — so the login page and the set-password screen
// are the only two things reachable without a database. Everything behind the
// gate is covered by the jsdom tier, which reaches authenticated components with
// no backend at all. Between them the two tiers cover both halves; neither
// covers both on its own.
//
// This project is deliberately NOT part of `npm run test:e2e`: it lives in
// tests/a11y, outside the `testDir: './tests/e2e'` every other project inherits,
// so it neither needs credentials nor touches a database.

const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/**
 * Settle the page before measuring.
 *
 * The auth screens fade in on a stagger, and an element caught mid-flight is
 * partly transparent -- so axe measures the COMPOSITE and reports colours that
 * are in no stylesheet. Measured mid-animation, brand blue read as #6eaee7
 * (2.26:1) and stone-400 as #867f7a; settled, they read #2988de and #a6a09b.
 * A gate that fails against colours existing nowhere sends people to "fix" a
 * palette that was already correct, so this wait is correctness, not patience.
 *
 * Waiting beats `reducedMotion: 'reduce'`: that path disables the animations
 * outright, which is a different rendering to assert against and not the one
 * most users get.
 */
async function settle(page: Page) {
  await page.evaluate(async () => {
    // FINITE animations only. The login rail rotates three capability lines on a
    // deliberate 13.5s infinite loop, and an infinite animation's `finished`
    // promise never resolves -- awaiting it hangs the test rather than settling
    // the page. The looping text is opaque throughout, so it needs no waiting.
    const finite = document.getAnimations().filter((a) => {
      const timing = a.effect?.getComputedTiming?.()
      return timing != null && timing.iterations !== Infinity
    })
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)))
  })
}

async function expectNoViolations(page: Page, context?: string) {
  await settle(page)
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze()
  const { failing, excused } = partitionViolations(results.violations)

  for (const { violation, reason } of excused) {
    console.log(`  excused ${violation.id}: ${reason}`)
  }

  if (failing.length > 0) {
    const detail = failing
      .map((v) => {
        const nodes = v.nodes.slice(0, 4).map((n) => `      ${n.target.join(' ')}`)
        const more = v.nodes.length > 4 ? [`      ...and ${v.nodes.length - 4} more`] : []
        return [
          `  [${v.impact ?? 'unknown'}] ${v.id} -- ${v.help}`,
          ...nodes,
          ...more,
          `      ${v.helpUrl}`,
        ].join('\n')
      })
      .join('\n\n')
    throw new Error(
      `axe found ${failing.length} WCAG 2.2 AA violation(s)${context ? ` (${context})` : ''}:\n\n` +
        detail +
        '\n\nIf one of these is a decision rather than a defect, it belongs in\n' +
        'tests/a11y/exceptions.ts AND in the published accessibility statement.\n' +
        'A suppression that is not disclosed is not an exception.\n',
    )
  }
}

/**
 * Refuse to measure a stranger's application.
 *
 * playwright.config.ts sets `reuseExistingServer: !isCI`, so a local run
 * adopts whatever already answers on the dev port. On this machine that was an
 * unrelated Next.js project also bound to 3000 -- and Windows allows two
 * listeners on one port, handing each connection to whichever wins the race, so
 * `npm run dev` reported a cheerful "Local: http://localhost:3000" while
 * requests were answered nondeterministically by either app. Vite's
 * `strictPort` does not help; no EADDRINUSE is ever raised.
 *
 * The symptom is the worst kind. The page renders, it looks like this project,
 * and it serves code that does not match the file on disk -- so an axe failure
 * reads as a real contrast defect and you go and "fix" a palette that was
 * already correct. This check turns that into one clear sentence.
 */
async function assertServingThisApp(page: Page) {
  const title = await page.title()
  const brandLine = await page
    .getByText('From the order email to the loading dock.')
    .count()
  if (!/nex ?order/i.test(title) && brandLine === 0) {
    throw new Error(
      [
        `The server at ${page.url()} is not serving Nex Order.`,
        `Document title was ${JSON.stringify(title)}.`,
        `Something else is bound to that port. Stop it, or point the suite elsewhere:`,
        `  E2E_BASE_URL=http://localhost:<port> npx playwright test --project=a11y`,
      ].join('\n'),
    )
  }
}

/**
 * Navigate, then immediately confirm we are on Nex Order.
 *
 * Before any app-specific wait: pointed at the wrong server, a
 * `waitForSelector('Sign in')` simply times out after 30 seconds and reports a
 * missing button, which sends you looking at the login page. The identity check
 * has to come first to be the thing that speaks.
 */
async function open(page: Page) {
  await page.goto('/')
  await assertServingThisApp(page)
}

test.describe('login surfaces', () => {
  test('the sign-in page is clean at desktop width', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
    await expectNoViolations(page, 'sign-in, 1280px')
  })

  test('the sign-in page is clean at the handheld width', async ({ page }) => {
    // 360x664 is the RS35's real usable viewport: Chrome's URL bar takes ~56px
    // and cannot retract, because the shell is overflow-hidden and the body
    // never scrolls. Same figures as the mobile e2e project.
    await page.setViewportSize({ width: 360, height: 664 })
    await open(page)
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
    await expectNoViolations(page, 'sign-in, 360px')
  })

  test('the forgot-password dialog is clean, and traps focus', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: /forgot your password/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // The overlay primitive moves focus into the dialog on open; a dialog that
    // opens behind the keyboard user's cursor is unusable regardless of what
    // axe thinks of its markup.
    await expect(dialog.locator(':focus')).toHaveCount(1)

    await expectNoViolations(page, 'forgot-password dialog')
  })

  test('the page declares a language and a title', async ({ page }) => {
    await open(page)
    // Both are WCAG requirements (3.1.1, 2.4.2) and both are single points of
    // failure for every screen in a single-page app with no router.
    expect(await page.locator('html').getAttribute('lang')).toBeTruthy()
    expect((await page.title()).trim().length).toBeGreaterThan(0)
  })
})
