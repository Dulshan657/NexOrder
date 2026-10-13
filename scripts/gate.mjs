#!/usr/bin/env node
// The gate: an independent, exact-commit verdict on a change.
//
// Runs the five gate rows against ONE commit in a detached worktree that is
// never anybody's working checkout, so the result describes that sha and
// nothing else — not a dirty tree, not a stale node_modules, not "it passed on
// my machine". It never edits, commits, pushes or deploys. The gate agent
// (.claude/agents/gate.md) runs this, then reads the diff for what rows can't see.
//
//   1  typecheck + release build     npx tsc --noEmit, npm run build
//   2  full unit suite               npm test; each failing FILE goes through the
//                                    flake protocol (scripts/lib/flakeVerdict.mjs)
//   3  Edge Function types           scripts/check-edge-types.mjs
//   4  guards                        lint + every source guard + check:demo (secret leak)
//   5  touched browser specs, whole  only with --e2e-base-url, never the deployed default
//
// Usage:
//   node scripts/gate.mjs --ref=<sha|branch|pr-number> [--workdir=<dir>] [--e2e-base-url=http://localhost:3000]
//                         [--rows=2,3]   run only these rows (diagnosis, or a box short on memory)
//                         [--base=<ref>] compare against this instead of the merge-base with
//                                        origin/main (a stacked branch; testing the gate itself)
// Exit: 0 = GO, 1 = NO-GO, 2 = could not run, 3 = PARTIAL (--rows; nothing failed,
// but it is NOT a merge verdict — only a full run can say GO).

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyFailure, failingTestsNotOnBase, gateVerdict, INITIAL_RUNS, keysOnEveryRun } from './lib/flakeVerdict.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GUARDS = ['lint', 'check:overlays', 'check:viewport', 'check:csp', 'check:claude-md', 'check:demo']

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function die(message) {
  console.error(`gate: ${message}`)
  process.exit(2)
}

// Windows needs a shell for npm/npx (.cmd) and Node deprecates args + shell
// (DEP0190), so join into one string there — quoting anything not plainly
// safe, because refs, branch names and test paths reach cmd.exe and a space or
// `&` would silently change which command ran.
// cmd.exe expands %VAR% even inside double quotes, so no quoting makes a `%`
// safe: refuse it rather than let a ref be rewritten before git sees it.
const SAFE_ARG = /^[\w@+=:,./\\~-]+$/
const winQuote = (a) => {
  if (a.includes('%')) die(`refusing an argument containing '%' (cmd.exe would expand it): ${a}`)
  return SAFE_ARG.test(a) ? a : `"${a.replaceAll('"', '""')}"`
}

function sh(argv, { cwd, env, capture = true } = {}) {
  const options = { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  if (!capture) options.stdio = 'inherit'
  const r = process.platform === 'win32'
    ? spawnSync(argv.map(winQuote).join(' '), { ...options, shell: true })
    : spawnSync(argv[0], argv.slice(1), options)
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

function git(args, cwd = REPO) {
  const r = sh(['git', ...args], { cwd })
  if (!r.ok) die(`git ${args.join(' ')} failed:\n${r.out}`)
  return r.out.trim()
}

function resolveRef(ref, baseRef) {
  git(['fetch', '--quiet', 'origin'])
  if (baseRef) {
    const sha = git(['rev-parse', '--verify', `${ref}~0`])
    const base = git(['rev-parse', '--verify', `${baseRef}~0`])
    // A base that is not behind the commit (itself, a later or a sideways one)
    // would make the commit's own failures read as "already red on the base".
    if (base === sha || !sh(['git', 'merge-base', '--is-ancestor', base, sha], { cwd: REPO }).ok) {
      die(`--base=${baseRef} must be a strict ancestor of ${ref}`)
    }
    return { sha, base, label: `${ref} (base ${baseRef})`, overridden: true }
  }
  if (/^\d+$/.test(ref)) {
    const pr = sh(['gh', 'pr', 'view', ref, '--json', 'headRefOid,baseRefName'], { cwd: REPO })
    if (!pr.ok) die(`cannot read PR #${ref}:\n${pr.out}`)
    const { headRefOid, baseRefName } = JSON.parse(pr.out)
    git(['fetch', '--quiet', 'origin', `pull/${ref}/head`])
    return { sha: headRefOid, base: git(['merge-base', headRefOid, `origin/${baseRefName}`]), label: `PR #${ref}` }
  }
  const sha = git(['rev-parse', '--verify', `${ref}~0`])
  return { sha, base: git(['merge-base', sha, 'origin/main']), label: ref }
}

// A detached worktree at exactly `sha`, reused between runs. Refuses to touch
// anything inside the repo checkout this script was launched from.
function assertOutsideCheckout(dir) {
  const rel = relative(REPO, dir)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) die(`workdir ${dir} is inside the live checkout — refusing`)
}

// A gate workdir is force-checked-out and `git clean -x`'d on every run, which
// would destroy uncommitted work and ignored files (.env.*.local, demo-export/)
// in anybody's checkout. So the gate only reuses a directory it created itself,
// proven by MARKER; any other existing directory is refused.
const MARKER = '.gate-workdir'

function prepareWorktree(dir, sha) {
  assertOutsideCheckout(dir)
  if (existsSync(dir) && !existsSync(join(dir, MARKER))) {
    die(`${dir} exists and was not created by the gate (no ${MARKER}) — refusing to reset it`)
  }
  if (existsSync(join(dir, '.git'))) {
    git(['checkout', '--quiet', '--force', '--detach', sha], dir)
    git(['clean', '-fdxq', '-e', 'node_modules', '-e', MARKER], dir)
  } else {
    git(['worktree', 'add', '--quiet', '--detach', dir, sha])
    writeFileSync(join(dir, MARKER), 'Created by scripts/gate.mjs; reset on every gate run.\n')
  }
  const lockHash = createHash('sha256').update(readFileSync(join(dir, 'package-lock.json'))).digest('hex')
  const stamp = join(dir, 'node_modules', '.gate-lock-hash')
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== lockHash) {
    const install = sh(['npm', 'ci', '--no-audit', '--no-fund'], { cwd: dir })
    if (!install.ok) die(`npm ci failed in ${dir}:\n${install.out.slice(-4000)}`)
    writeFileSync(stamp, lockHash)
  }
}

function step(cwd, argv, logs, name, env) {
  const started = Date.now()
  const r = sh(argv, { cwd, env })
  writeFileSync(join(logs, `${name}.log`), r.out)
  return { ok: r.ok, ms: Date.now() - started, tail: r.out.split('\n').slice(-25).join('\n') }
}

function runRow(cwd, logs, steps) {
  const results = steps.map(([name, argv, env]) => ({ name, ...step(cwd, argv, logs, name, env) }))
  return { status: results.every((r) => r.ok) ? 'pass' : 'fail', steps: results }
}


// The gate's own reporter, by absolute path from THIS checkout, so it also
// loads when gating an older commit that predates it.
const REPORTER = join(REPO, 'scripts', 'gate-reporter.mjs')

// vitest with the gate reporter; returns the run's ok plus what the reporter
// recorded: { modules: { file: { state, keys } }, unhandled: string[] } or null.
function vitestWithKeys(cwd, args, out) {
  const r = sh(['npx', 'vitest', 'run', ...args, '--reporter=default', `--reporter=${REPORTER}`], {
    cwd,
    env: { GATE_REPORT_OUT: out },
  })
  const report = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null
  return { ...r, report }
}

// file -> its failure keys, for every module that failed in any way.
function failingModules(report) {
  if (!report) return null
  return new Map(
    Object.entries(report.modules)
      .filter(([, m]) => m.state === 'failed' || m.keys.length > 0)
      .map(([file, m]) => [file, m.keys]),
  )
}

function rerun(cwd, file, times) {
  return Array.from({ length: times }, () => sh(['npx', 'vitest', 'run', file], { cwd }).ok)
}

// Base runs record WHICH failures they have, so a file red on both sides is
// excused only when the tip adds no failure of its own — at any level. Every
// base run records keys, and only failures on ALL of them count as "already on
// the base" (keysOnEveryRun): one lucky failing run of a flaky base test must
// not excuse a tip that fails it every time. A run whose report is missing
// contributes no keys, which shrinks the intersection — it fails closed.
function baseRunsWithKeys(cwd, file, times) {
  return Array.from({ length: times }, () => {
    const { ok, report } = vitestWithKeys(cwd, [file], join(cwd, '.gate-base-run.json'))
    return { ok, keys: report?.modules?.[file]?.keys ?? [] }
  })
}

function flakeProtocol(failures, tipDir, baseDir, base) {
  if (failures.size === 0) return []
  prepareWorktree(baseDir, base)
  return [...failures].map(([file, tipFailed]) => {
    const onBase = existsSync(join(baseDir, file))
    const baseRuns = onBase ? baseRunsWithKeys(baseDir, file, INITIAL_RUNS) : []
    const judge = () => ({
      newFailingTests: failingTestsNotOnBase(tipFailed, keysOnEveryRun(baseRuns.map((r) => r.keys))),
    })
    const record = {
      tip: rerun(tipDir, file, INITIAL_RUNS),
      base: onBase ? baseRuns.map((r) => r.ok) : [true],
      ...judge(),
    }
    let verdict = classifyFailure(record)
    if (verdict.moreRuns > 0) {
      record.tip.push(...rerun(tipDir, file, verdict.moreRuns))
      if (onBase) {
        baseRuns.push(...baseRunsWithKeys(baseDir, file, verdict.moreRuns))
        record.base = baseRuns.map((r) => r.ok)
        Object.assign(record, judge())
      }
      verdict = classifyFailure(record)
    }
    return { file, newFile: !onBase, ...record, ...verdict }
  })
}

function touchedSpecs(sha, base) {
  return git(['diff', '--name-only', `${base}..${sha}`, '--', 'tests'])
    .split('\n')
    .filter((f) => f.endsWith('.spec.ts'))
}

const runsText = (runs) => runs.map((p) => (p ? '✓' : '✗')).join('')

function report(meta, rows, flakes) {
  const icon = { pass: '✅ pass', fail: '❌ FAIL', 'n/a': '— n/a', skipped: '⚠️ skipped' }
  const lines = [
    `# Gate report — ${meta.label}`,
    '',
    `- **Commit:** \`${meta.sha}\` (exact; detached worktree, nothing overwritten)`,
    `- **Base:** \`${meta.base}\` (${arg('base') ? `--base=${arg('base')}` : 'merge-base with origin/main'})`,
    `- **Verdict:** **${meta.verdict}**${meta.verdict === 'PARTIAL' ? ' — what ran passed; NOT a merge verdict (needs a full run against the merge-base)' : ''}`,
    '',
    '| # | Row | Result | Detail |',
    '|---|---|---|---|',
    ...rows.map((r, i) => `| ${i + 1} | ${r.title} | ${icon[r.status]} | ${r.detail ?? r.steps?.map((s) => `${s.name} ${s.ok ? '✓' : '✗'} ${(s.ms / 1000).toFixed(0)}s`).join(' · ') ?? ''} |`),
  ]
  if (flakes.length > 0) {
    lines.push('', '## Flake protocol', '', '| File | Tip (alone) | Base (alone) | Verdict |', '|---|---|---|---|')
    for (const f of flakes) {
      lines.push(`| \`${f.file}\` | ${runsText(f.tip)} | ${f.newFile ? 'new file' : runsText(f.base)} | **${f.verdict}**${f.blocking ? ' (blocking)' : ''} |`)
    }
  }
  lines.push(
    '',
    '## Not claimed',
    '',
    '- The build is not network-isolated on this machine.',
    '- No remote second-machine run and no resource soak — CI is the second machine.',
    ...(meta.partial ? ['- Only the rows passed in `--rows` ran; the others are claimed for nothing.'] : []),
    ...(meta.overridden ? ['- The base was chosen with `--base`, so "pre-existing" means "red on that commit", not "red on main".'] : []),
    ...(!meta.partial && rows[4].status === 'skipped' ? ['- Touched browser specs were NOT run (no `--e2e-base-url`).'] : []),
    '- Nothing about the RS35 handheld: emulation cannot reach its IME scan mode.',
  )
  return lines.join('\n')
}

function main() {
  const ref = arg('ref') ?? die('--ref=<sha|branch|pr-number> is required')
  const workdir = resolve(arg('workdir') ?? join(homedir(), 'nexgate'))
  const e2eBase = arg('e2e-base-url')
  if (e2eBase && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(e2eBase)) {
    die('--e2e-base-url must be a localhost URL: a deployed site says nothing about this commit')
  }

  const rowsArg = arg('rows')
  const want = new Set(rowsArg ? rowsArg.split(',').map(Number) : [1, 2, 3, 4, 5])
  if ([...want].some((n) => !Number.isInteger(n) || n < 1 || n > 5)) die('--rows takes row numbers 1-5, e.g. --rows=2,3')
  const notRun = { status: 'skipped', detail: 'not run (--rows)' }

  assertOutsideCheckout(workdir)
  const meta = resolveRef(ref, arg('base'))
  console.log(`gate: ${meta.label} @ ${meta.sha.slice(0, 10)} (base ${meta.base.slice(0, 10)}) in ${workdir}`)
  prepareWorktree(workdir, meta.sha)
  const logs = join(workdir, '.gate-logs')
  mkdirSync(logs, { recursive: true })

  let row1 = notRun
  if (want.has(1)) {
    console.log('gate: row 1 — typecheck + build')
    row1 = runRow(workdir, logs, [['tsc', ['npx', 'tsc', '--noEmit']], ['build', ['npm', 'run', 'build']]])
  }

  const { row: row2, flakes } = want.has(2) ? unitRow(workdir, logs, meta) : { row: notRun, flakes: [] }

  let row3 = notRun
  if (want.has(3)) {
    console.log('gate: row 3 — Edge Function types')
    row3 = runRow(workdir, logs, [['edge-types', ['node', 'scripts/check-edge-types.mjs']]])
  }

  let row4 = notRun
  if (want.has(4)) {
    console.log('gate: row 4 — guards')
    row4 = runRow(workdir, logs, GUARDS.map((g) => [g, ['npm', 'run', g]]))
  }

  const row5 = want.has(5) ? browserRow(workdir, logs, meta, e2eBase) : notRun

  const rows = [
    { title: 'Type-check + release build', ...row1 },
    { title: 'Full unit suite (+ flake protocol)', ...row2 },
    { title: 'Edge Function types (deno check)', ...row3 },
    { title: 'Guards: a11y lint, overlays, viewport, CSP, CLAUDE.md, demo-secret surface', ...row4 },
    { title: 'Touched browser specs, run whole', ...row5 },
  ]
  meta.partial = want.size < 5
  meta.overridden = Boolean(meta.overridden)
  Object.assign(meta, gateVerdict({ anyFailed: rows.some((r) => r.status === 'fail'), ...meta }))

  const md = report(meta, rows, flakes)
  writeFileSync(join(workdir, 'gate-report.md'), md)
  writeFileSync(join(workdir, 'gate-report.json'), JSON.stringify({ ...meta, rows, flakes }, null, 2))
  console.log(`
${md}
`)
  for (const row of rows) {
    for (const s of row.steps ?? []) if (!s.ok) console.log(`--- ${s.name} (tail of .gate-logs/${s.name}.log) ---
${s.tail}
`)
  }
  console.log(`gate: report at ${join(workdir, 'gate-report.md')}`)
  process.exit(meta.exitCode)
}

function unitRow(workdir, logs, meta) {
  console.log('gate: row 2 — full unit suite')
  const keysPath = join(logs, 'failure-keys.json')
  const row2 = runRow(workdir, logs, [
    ['unit', ['npx', 'vitest', 'run', '--reporter=default', `--reporter=${REPORTER}`], { GATE_REPORT_OUT: keysPath }],
  ])
  const report = existsSync(keysPath) ? JSON.parse(readFileSync(keysPath, 'utf8')) : null
  const failing = row2.status === 'fail' ? failingModules(report) : new Map()
  console.log(failing?.size ? `gate: flake protocol on ${failing.size} file(s)` : 'gate: no failing test files')
  const flakes = flakeProtocol(failing ?? new Map(), workdir, `${workdir}-base`, meta.base)
  // An unhandled error/rejection fails the run without belonging to any file.
  // The reporter records them; the log regex is a second witness in case the
  // reporter itself never ran. While one is present nothing may be excused.
  const unhandled =
    (report?.unhandled?.length ?? 0) > 0 ||
    /Unhandled (Error|Rejection)|Errors\s+\d+ errors?/.test(readFileSync(join(logs, 'unit.log'), 'utf8'))
  // The suite failed without naming a file (crash, config error): block outright.
  if (row2.status === 'fail' && (failing === null || failing.size === 0)) row2.detail = 'suite failed without a per-file result — see .gate-logs/unit.log'
  else if (row2.status === 'fail' && unhandled) row2.detail = 'unhandled error in the suite, not attributable to a file — see .gate-logs/unit.log'
  else if (row2.status === 'fail' && flakes.every((f) => !f.blocking)) {
    row2.status = 'pass'
    row2.detail = `only pre-existing failures (also red on base): ${flakes.map((f) => f.file).join(', ')}`
  }
  return { row: row2, flakes }
}

function browserRow(workdir, logs, meta, e2eBase) {
  const specs = touchedSpecs(meta.sha, meta.base)
  if (specs.length === 0) return { status: 'n/a', detail: 'no browser spec touched' }
  if (!e2eBase) return { status: 'skipped', detail: `touched, not run: ${specs.join(', ')}` }
  console.log(`gate: row 5 — ${specs.length} touched spec(s) against ${e2eBase}`)
  return runRow(workdir, logs, [['e2e', ['npx', 'playwright', 'test', ...specs], { E2E_BASE_URL: e2eBase }]])
}

main()
