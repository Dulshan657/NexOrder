import AxeBuilder from '@axe-core/playwright'
import { test } from '../e2e/fixtures/auth'

// AN INSTRUMENT, NOT A REGRESSION TEST -- the same standing as `perf` and
// `soak`, and excluded from CI for the same kind of reason: it needs real
// credentials, so it cannot be a gate.
//
//   E2E_WAREHOUSE_EMAIL=... E2E_WAREHOUSE_PASSWORD=... \
//     E2E_BASE_URL=http://localhost:3311 npx playwright test --project=contrast
//
// It exists because the other two accessibility tiers each have a hole exactly
// where colour lives. The jsdom suite reaches authenticated components but has
// no layout and no computed colour, so axe disables `color-contrast` there
// outright. The browser suite measures colour properly but, with no router and
// everything behind AuthGate, can only reach the two signed-out screens. So the
// contrast of every authenticated surface in the product was measured by
// nothing at all until this ran.
//
// It writes nothing: it navigates and reads. `count-bin` and friends are never
// touched.
//
// FIRST RUN (2026-08-28, after the stone-400 sweep): 28 distinct failures across
// the ten Warehouse surfaces. Thirteen were real and are fixed -- stone-500 on a
// bg-stone-100 tint at 4.38:1 in the segmented controls, the stocktake badges
// and the map/overlay controls, where the tint sits on a PARENT and no
// same-line rule could ever have found it, plus two stone-300 items at 1.48:1.
// Fifteen remain, and both groups are decisions rather than oversights:
//   * 14 x brand blue -- #2988de on white or as a fill (3.70:1) and on its own
//     /10 tint (3.30:1). Kept deliberately; disclosed in the accessibility
//     statement.
//   * 1 x white on bg-amber-500 (2.13:1), the `warning` severity badge. Note
//     that its siblings fail too -- red-500 and blue-500 with white text are
//     ~3.7:1 -- so this is the whole severity palette, not one badge, and
//     changing it is a semantic-colour decision rather than a contrast fix.

const TABS = [
  'Pick Queue', 'Dispatched', 'Receiving', 'Putaway', 'Replenishment',
  'Off-home', 'Stocktake', 'Stock', 'Documents', 'Warehouse',
]

test('contrast crawl (warehouse surfaces)', async ({ warehousePage: page }) => {
  test.setTimeout(300_000)
  const found = new Map<string, { ratio: unknown; fg: unknown; bg: unknown; where: string; tab: string }>()

  for (const tab of TABS) {
    await page.goto(`/?tab=${encodeURIComponent(tab)}`)
    await page.waitForTimeout(2500)
    await page.evaluate(async () => {
      const finite = document.getAnimations().filter((a) => {
        const t = a.effect?.getComputedTiming?.()
        return t != null && t.iterations !== Infinity
      })
      await Promise.all(finite.map((a) => a.finished.catch(() => undefined)))
    })

    const r = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
    let n = 0
    for (const v of r.violations) {
      for (const node of v.nodes) {
        n++
        const d = (node.any?.[0] as { data?: Record<string, unknown> })?.data ?? {}
        const key = `${d.fgColor}|${d.bgColor}|${String(node.target[0]).slice(0, 40)}`
        if (!found.has(key)) {
          found.set(key, {
            ratio: d.contrastRatio, fg: d.fgColor, bg: d.bgColor,
            where: String(node.target[0]).slice(0, 70), tab,
          })
        }
      }
    }
    console.log(`TAB ${tab.padEnd(15)} contrast violations: ${n}`)
  }

  console.log(`\nDISTINCT residue: ${found.size}`)
  for (const v of [...found.values()].sort((a, b) => Number(a.ratio) - Number(b.ratio))) {
    console.log(`  ${String(v.ratio).padEnd(6)} fg=${v.fg} bg=${v.bg}  [${v.tab}] ${v.where}`)
  }
})
