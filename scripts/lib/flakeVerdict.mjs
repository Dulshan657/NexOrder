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
 * Remove a workdir from a message, in both slash forms. A file-level message
 * carries the absolute path (nexgate vs nexgate-base), so without this the same
 * failure on both sides compares as different.
 */
export function stripRoot(text, root) {
  return text.replaceAll(root.replaceAll('\\', '/'), '<root>').replaceAll(root, '<root>')
}

// CI's runner (public repo: 4 vCPU / 16 GB) gives vitest cpus-1 = 3 workers;
// the gate judges the commit at that load. See scripts/gate.mjs.
export const DEFAULT_UNIT_WORKERS = 3

/**
 * A run is a merge verdict only at all five rows AND CI's worker count — a
 * lighter run hides load-sensitivity CI would see, a heavier one invents it.
 * @param {{ rows: number[], unitWorkers: number }} run
 */
export function isPartialRun({ rows, unitWorkers }) {
  return new Set(rows).size < 5 || unitWorkers !== DEFAULT_UNIT_WORKERS
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
 * "Known failures named in advance" (config/knownFlakes.json). A listing
 * excuses exactly ONE shape: a `flake` whose tip PASSED EVERY RUN ALONE — it
 * fails only inside the loaded full suite. Everything else still blocks:
 * - any other verdict (a listing never excuses a regression);
 * - a `flake` whose tip failed alone even once — `flake` also covers "fails
 *   every time alone over an unsteady base", which is in effect a regression
 *   (the gate's eighth review: a PR breaking the source under a listed test
 *   would otherwise have been excused);
 * - a file the change touches (a PR editing a known-flaky test owns it again);
 * - an entry not ALREADY on the base — a PR cannot list its own failure.
 * @param {{file:string, verdict:string, blocking:boolean, tip:boolean[]}[]} flakes
 * @param {{ tip: object[], base: object[] }} known  the registry on each side
 * @param {string[]} touchedFiles  files changed between base and tip
 */
export function applyKnownFlakes(flakes, known, touchedFiles) {
  for (const k of [...known.tip, ...known.base]) {
    if (!k?.file || !k.reason?.trim() || !k.since) {
      throw new Error(`knownFlakes: every entry needs file, reason and since — got ${JSON.stringify(k)}`)
    }
  }
  const onBoth = (file) => known.tip.find((k) => k.file === file && known.base.some((b) => b.file === file))
  const touched = new Set(touchedFiles)
  return flakes.map((f) => {
    const listing = onBoth(f.file)
    const suiteOnly = f.tip.length > 0 && f.tip.every((passed) => passed)
    if (f.verdict !== 'flake' || !suiteOnly || !listing || touched.has(f.file)) return f
    return { ...f, verdict: 'known-flake', blocking: false, knownReason: listing.reason }
  })
}

/**
 * Failure keys present on EVERY run — a multiset intersection (minimum count).
 * The base side is judged by this, not by one run: a test that only sometimes
 * fails on the base, caught failing once, would otherwise make a tip that
 * fails it every time look pre-existing.
 * @param {string[][]} runs
 */
export function keysOnEveryRun(runs) {
  if (runs.length === 0) return []
  const counts = (keys) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map())
  const [first, ...rest] = runs
  const restCounts = rest.map(counts)
  const taken = new Map()
  return first.filter((key) => {
    const min = Math.min(...restCounts.map((c) => c.get(key) ?? 0))
    const used = taken.get(key) ?? 0
    if (used >= min) return false
    taken.set(key, used + 1)
    return true
  })
}

/**
 * Tip failure keys the base does not also have. A file red on both sides is
 * only `pre-existing` when this is empty: judging per FILE let a brand-new
 * failure hide inside a file main already had red.
 *
 * A MULTISET difference, not a set one: a new failing test that shares its full
 * name with one already red on the base (copy-paste, `it.each` without a
 * placeholder), or a second identical suite error, is still new.
 *
 * Granularity is per KEY — one per failed test, suite error or module error.
 * A test already red on the base that gains a second, different reason to fail
 * (a throwing `afterEach` on that same test) adds no key; anything that breaks
 * a test that was passing, or adds a suite/module error, does.
 * @param {string[]} tipFailed
 * @param {string[]} baseFailed
 */
export function failingTestsNotOnBase(tipFailed, baseFailed) {
  const remaining = new Map()
  for (const key of baseFailed) remaining.set(key, (remaining.get(key) ?? 0) + 1)
  return tipFailed.filter((key) => {
    const left = remaining.get(key) ?? 0
    if (left === 0) return true
    remaining.set(key, left - 1)
    return false
  })
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
