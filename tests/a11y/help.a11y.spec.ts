import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { partitionViolations } from './exceptions'

// The help centre (NX-0038) in a real browser. Like the login page it is
// reachable signed out -- /help branches in index.tsx before AuthGate -- so it is
// the third surface this tier can measure for colour contrast, which the jsdom
// tier (__tests__/a11y/help.test.tsx) cannot see at all.

const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function expectNoViolations(page: Page, context: string) {
  // Every screenshot decoded, so the callout badges are measured over the image
  // they really sit on, not over an empty box.
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => undefined))))
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze()
  const { failing, excused } = partitionViolations(results.violations)
  for (const { violation, reason } of excused) console.log(`  excused ${violation.id}: ${reason}`)
  const detail = failing
    .map((v) => `  [${v.impact ?? 'unknown'}] ${v.id} -- ${v.help}\n${v.nodes.slice(0, 4).map((n) => `      ${n.target.join(' ')}`).join('\n')}`)
    .join('\n\n')
  expect(failing, `axe found WCAG 2.2 AA violations (${context}):\n\n${detail}`).toEqual([])
}

test.describe('help centre', () => {
  test('the index is clean, signed out', async ({ page }) => {
    await page.goto('/help')
    await expect(page.getByRole('heading', { level: 1, name: /receipt & putaway/i })).toBeVisible()
    await expectNoViolations(page, '/help, 1280px')
  })

  test('an article is clean at the handheld width', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 664 })
    await page.goto('/help/receive-a-delivery?for=floor')
    await expect(page.getByRole('heading', { level: 1, name: /receive a delivery/i })).toBeVisible()
    await expectNoViolations(page, '/help/receive-a-delivery, 360px')
  })
})
