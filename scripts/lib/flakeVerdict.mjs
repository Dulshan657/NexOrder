// The gate's flake protocol, as a pure decision so it can be tested without
// running anything. scripts/gate.mjs does the I/O: when a test file fails in
// the full suite it reruns that file ALONE on the tip and on the merge-base,
// feeds the pass/fail record in here, and does whatever `moreRuns` asks.
//
// The point is to stop two opposite mistakes: blaming a change for a failure
// main already had (`pre-existing`), and waving through a real regression as
// "probably flaky". Only a failure that is consistent on the tip AND absent on
// the base counts as `regression`; anything inconsistent is `flake`, which
// still BLOCKS — a flake is a ticket to write, not a pass.

export const INITIAL_RUNS = 3
export const MIXED_RUNS = 5

const isMixed = (runs) => runs.includes(true) && runs.includes(false)
const allFail = (runs) => runs.every((passed) => !passed)
const allPass = (runs) => runs.every((passed) => passed)

/**
 * Tip failures the base does not also have, compared by full test name. A file
 * that is red on both sides is only `pre-existing` when this is empty: judging
 * per FILE let a brand-new failure hide inside a file main already had red.
 * @param {string[]} tipFailed
 * @param {string[]} baseFailed
 */
export function failingTestsNotOnBase(tipFailed, baseFailed) {
  const onBase = new Set(baseFailed)
  return tipFailed.filter((name) => !onBase.has(name))
}

/**
 * @param {{ tip: boolean[], base: boolean[], newFailingTests?: string[] }} record
 *   true = that run passed; newFailingTests = failingTestsNotOnBase(...) for the file
 * @returns {{ verdict: 'regression'|'pre-existing'|'flake'|'undecided', blocking: boolean, moreRuns: number }}
 */
export function classifyFailure({ tip, base, newFailingTests = [] }) {
  if (tip.length === 0 || base.length === 0) {
    throw new Error('classifyFailure: each side needs at least one run')
  }

  const shortfall = Math.max(
    isMixed(tip) ? MIXED_RUNS - tip.length : 0,
    isMixed(base) ? MIXED_RUNS - base.length : 0,
  )
  if (shortfall > 0) return { verdict: 'undecided', blocking: true, moreRuns: shortfall }

  if (allFail(tip) && allPass(base)) return { verdict: 'regression', blocking: true, moreRuns: 0 }
  if (allFail(tip) && allFail(base)) {
    return newFailingTests.length > 0
      ? { verdict: 'regression', blocking: true, moreRuns: 0 }
      : { verdict: 'pre-existing', blocking: false, moreRuns: 0 }
  }
  // Passes alone every time on the tip (failed only inside the full suite —
  // order or isolation dependent), still mixed after MIXED_RUNS, or a steady
  // tip failure over an unsteady base: none is a clean signal either way.
  return { verdict: 'flake', blocking: true, moreRuns: 0 }
}
