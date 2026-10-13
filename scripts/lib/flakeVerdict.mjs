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
 * The failure "names" of one vitest JSON testResult. A file that fails to LOAD
 * (bad import, failing afterAll) is `failed` with no failed test under it, so
 * it is named by its file-level message instead — otherwise a new load failure
 * inside a file the base already had red would compare as "nothing new".
 * @param {{ status: string, message?: string, assertionResults: { fullName: string, status: string }[] }} result
 */
export function failedTestNames(result) {
  const names = result.assertionResults.filter((a) => a.status === 'failed').map((a) => a.fullName)
  if (result.status !== 'failed') return names
  // vitest's `message` is file.result.errors[0] — FILE-level only, never a
  // per-test failure — so it always counts, alongside any failing tests: a
  // throwing afterAll leaves every test result intact and lands only here.
  const firstLine = (result.message ?? '').split('\n')[0].trim()
  if (firstLine) return [...names, `[file failed] ${firstLine}`]
  return names.length > 0 ? names : ['[file failed] no message']
}

/**
 * Remove a workdir from a message, in both slash forms. A file-level message
 * carries the absolute path (nexgate vs nexgate-base), so without this the same
 * failure on both sides compares as different.
 */
export function stripRoot(text, root) {
  return text.replaceAll(root.replaceAll('\\', '/'), '<root>').replaceAll(root, '<root>')
}

/**
 * The run's verdict. GO is reserved for a FULL run against the merge-base:
 * `--rows` skips rows and `--base` chooses what counts as "already red", so a
 * passing run with either can only be PARTIAL — and `go` is false, so nothing
 * reading only that field mistakes it for a merge verdict.
 */
export function gateVerdict({ anyFailed, partial, overridden }) {
  if (anyFailed) return { verdict: 'NO-GO', go: false, exitCode: 1 }
  if (partial || overridden) return { verdict: 'PARTIAL', go: false, exitCode: 3 }
  return { verdict: 'GO', go: true, exitCode: 0 }
}

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
