// axe-core against a rendered container, for the jsdom (`ui`) project.
//
// WHAT THIS TIER CAN AND CANNOT SEE, stated up front because the gap matters:
// jsdom has no layout and no computed colour, so axe DISABLES `color-contrast`
// here and it will never fail no matter how bad the palette gets. Contrast is
// checked in a real browser instead (tests/a11y/*.spec.ts, and a one-off
// authenticated crawl recorded in KNOWN-ERRORS-REGISTER.md).
//
// What it does see is the half that unit tests are unusually good at: accessible
// names, roles, ARIA validity, label association, heading order and landmark
// structure -- on AUTHENTICATED surfaces, with no database, which is the reason
// this tier exists at all. The Playwright tier can only reach the two screens a
// signed-out visitor can load.
//
// Deliberately not `vitest-axe` / `jest-axe`: those are thin, sporadically
// maintained wrappers over roughly the code below, and this way the rule set and
// the failure message are ours to state precisely.
import axe, { type AxeResults, type Result } from 'axe-core'

/**
 * The rule set. WCAG 2.2 AA and its predecessors -- the conformance target --
 * and nothing else. `best-practice` rules are deliberately excluded: they are
 * opinions, they are numerous, and mixing them in would make a failure here
 * ambiguous about whether conformance actually broke.
 */
const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

function describe(violations: readonly Result[]): string {
  return violations
    .map((v) => {
      const where = v.nodes
        .slice(0, 4)
        .map((n) => `      ${n.target.join(' ')}`)
        .join('\n')
      const more = v.nodes.length > 4 ? `\n      ...and ${v.nodes.length - 4} more` : ''
      return `  [${v.impact ?? 'unknown'}] ${v.id} -- ${v.help}\n${where}${more}\n      ${v.helpUrl}`
    })
    .join('\n\n')
}

export interface AxeOptions {
  /**
   * Rule ids to skip, each with a reason.
   *
   * Use this ONLY for something the environment cannot judge, never to silence a
   * real finding. Anything genuinely accepted belongs in the published
   * accessibility statement, not hidden in a test file.
   */
  skip?: Record<string, string>
}

/** Run axe over `container` and throw a readable failure if it finds anything. */
export async function expectNoA11yViolations(
  container: HTMLElement,
  { skip = {} }: AxeOptions = {},
): Promise<void> {
  const results: AxeResults = await axe.run(container, {
    runOnly: { type: 'tag', values: WCAG_AA_TAGS },
    ...(Object.keys(skip).length
      ? { rules: Object.fromEntries(Object.keys(skip).map((id) => [id, { enabled: false }])) }
      : {}),
  })

  if (results.violations.length === 0) return

  const skipped = Object.entries(skip)
    .map(([id, why]) => `  (skipped ${id}: ${why})`)
    .join('\n')

  throw new Error(
    `axe found ${results.violations.length} WCAG 2.2 AA violation(s):\n\n` +
      describe(results.violations) +
      (skipped ? `\n\n${skipped}` : ''),
  )
}
