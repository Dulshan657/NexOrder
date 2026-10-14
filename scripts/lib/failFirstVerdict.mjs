// Fail-first: each test a brief names must FAIL on the base (the change's own
// test, run against the code as it was) and PASS on the tip. Pure — the runs
// happen in scripts/check-brief.mjs, which feeds each side's gate-reporter
// output (scripts/gate-reporter.mjs) in here.
//
// A test that also passes on the base proves nothing about the change: it
// would have been green without it. That is the shape this exists to block.

/**
 * What happened to one named test in one run.
 * @param {{ modules: Record<string, { keys: string[], passed?: string[] }> } | null} report
 * @returns {'passed'|'failed'|'load-error'|'missing'}
 */
export function testOutcome(report, file, test) {
  const m = report?.modules?.[file]
  if (!m) return 'missing'
  const keys = m.keys ?? []
  if (keys.includes(test)) return 'failed'
  // A hook that throws on an enclosing suite fails every test inside it.
  if (keys.some((k) => {
    const at = k.indexOf(' [suite] ')
    return at > 0 && test.startsWith(`${k.slice(0, at)} > `)
  })) return 'failed'
  if ((m.passed ?? []).includes(test)) return 'passed'
  if (keys.some((k) => k.startsWith('[module] '))) return 'load-error'
  return 'missing'
}

/**
 * @param {{ base: string, tip: string }} outcomes  from testOutcome
 * @returns {{ verdict: 'proven'|'proven-by-absence'|'not-fail-first'|'tip-red'|'unknown-test'|'base-not-run', blocking: boolean }}
 */
export function judgeFailFirst({ base, tip }) {
  if (tip === 'missing') return { verdict: 'unknown-test', blocking: true }
  if (tip !== 'passed') return { verdict: 'tip-red', blocking: true }
  if (base === 'failed') return { verdict: 'proven', blocking: false }
  // The test could not even load on the base — usually because the module it
  // tests is new. Legitimate, but weaker than an assertion failing: reported.
  if (base === 'load-error') return { verdict: 'proven-by-absence', blocking: false }
  if (base === 'passed') return { verdict: 'not-fail-first', blocking: true }
  return { verdict: 'base-not-run', blocking: true }
}
