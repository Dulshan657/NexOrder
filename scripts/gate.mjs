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
// Exit: 0 = GO, 1 = NO-GO, 2 = could not run.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyFailure, failingTestsNotOnBase, INITIAL_RUNS } from './lib/flakeVerdict.mjs'

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
const SAFE_ARG = /^[\w@%+=:,./\\~-]+$/
const winQuote = (a) => (SAFE_ARG.test(a) ? a : `"${a.replaceAll('"', '""')}"`)

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

function resolveRef(ref) {
  git(['fetch', '--quiet', 'origin'])
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

// file -> full names of its failing tests, from a vitest JSON report.
function failingTests(jsonPath, cwd) {
  if (!existsSync(jsonPath)) return null
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'))
  return new Map(
    report.testResults
      .filter((t) => t.status === 'failed')
      .map((t) => [
        relative(cwd, t.name).replaceAll('\\', '/'),
        t.assertionResults.filter((a) => a.status === 'failed').map((a) => a.fullName),
      ]),
  )
}

function rerun(cwd, file, times) {
  return Array.from({ length: times }, () => sh(['npx', 'vitest', 'run', file], { cwd }).ok)
}

// One base run that also records WHICH tests failed, so a file red on both
// sides is excused only when the tip adds no failing test of its own.
function baseRunWithNames(cwd, file) {
  const out = join(cwd, '.gate-base-run.json')
  const ok = sh(['npx', 'vitest', 'run', file, '--reporter=json', `--outputFile.json=${out}`], { cwd }).ok
  return { ok, failed: failingTests(out, cwd)?.get(file) ?? [] }
}

function flakeProtocol(failures, tipDir, baseDir, base) {
  if (failures.size === 0) return []
  prepareWorktree(baseDir, base)
  return [...failures].map(([file, tipFailed]) => {
    const onBase = existsSync(join(baseDir, file))
    const first = onBase ? baseRunWithNames(baseDir, file) : { ok: true, failed: [] }
    const record = {
      tip: rerun(tipDir, file, INITIAL_RUNS),
      base: onBase ? [first.ok, ...rerun(baseDir, file, INITIAL_RUNS - 1)] : [true],
      newFailingTests: failingTestsNotOnBase(tipFailed, first.failed),
    }
    let verdict = classifyFailure(record)
    if (verdict.moreRuns > 0) {
      record.tip.push(...rerun(tipDir, file, verdict.moreRuns))
      if (onBase) record.base.push(...rerun(baseDir, file, verdict.moreRuns))
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
    `- **Base:** \`${meta.base}\` (merge-base with origin/main)`,
    `- **Verdict:** ${meta.go ? '**GO**' : '**NO-GO**'}`,
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
    ...(rows[4].status === 'skipped' ? ['- Touched browser specs were NOT run (no `--e2e-base-url`).'] : []),
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

  assertOutsideCheckout(workdir)
  const meta = resolveRef(ref)
  console.log(`gate: ${meta.label} @ ${meta.sha.slice(0, 10)} (base ${meta.base.slice(0, 10)}) in ${workdir}`)
  prepareWorktree(workdir, meta.sha)
  const logs = join(workdir, '.gate-logs')
  mkdirSync(logs, { recursive: true })

  console.log('gate: row 1 — typecheck + build')
  const row1 = runRow(workdir, logs, [['tsc', ['npx', 'tsc', '--noEmit']], ['build', ['npm', 'run', 'build']]])

  console.log('gate: row 2 — full unit suite')
  const vitestJson = join(logs, 'vitest.json')
  const row2 = runRow(workdir, logs, [['unit', ['npx', 'vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${vitestJson}`]]])
  const failing = row2.status === 'fail' ? failingTests(vitestJson, workdir) : new Map()
  console.log(failing?.size ? `gate: flake protocol on ${failing.size} file(s)` : 'gate: no failing test files')
  const flakes = flakeProtocol(failing ?? new Map(), workdir, `${workdir}-base`, meta.base)
  // An unhandled error/rejection fails the run without marking any file failed,
  // and vitest's JSON has no field for it, so read the console log. While one is
  // present nothing may be excused as pre-existing: it is unaccounted for.
  const unhandled = /Unhandled (Error|Rejection)|Errors\s+\d+ errors?/.test(readFileSync(join(logs, 'unit.log'), 'utf8'))
  // The suite failed without naming a file (crash, config error): block outright.
  if (row2.status === 'fail' && (failing === null || failing.size === 0)) row2.detail = 'suite failed without a per-file result — see .gate-logs/unit.log'
  else if (row2.status === 'fail' && unhandled) row2.detail = 'unhandled error in the suite, not attributable to a file — see .gate-logs/unit.log'
  else if (row2.status === 'fail' && flakes.every((f) => !f.blocking)) {
    row2.status = 'pass'
    row2.detail = `only pre-existing failures (also red on base): ${flakes.map((f) => f.file).join(', ')}`
  }

  console.log('gate: row 3 — Edge Function types')
  const row3 = runRow(workdir, logs, [['edge-types', ['node', 'scripts/check-edge-types.mjs']]])

  console.log('gate: row 4 — guards')
  const row4 = runRow(workdir, logs, GUARDS.map((g) => [g, ['npm', 'run', g]]))

  const specs = touchedSpecs(meta.sha, meta.base)
  let row5
  if (specs.length === 0) row5 = { status: 'n/a', detail: 'no browser spec touched' }
  else if (!e2eBase) row5 = { status: 'skipped', detail: `touched, not run: ${specs.join(', ')}` }
  else {
    console.log(`gate: row 5 — ${specs.length} touched spec(s) against ${e2eBase}`)
    row5 = runRow(workdir, logs, [['e2e', ['npx', 'playwright', 'test', ...specs], { E2E_BASE_URL: e2eBase }]])
  }

  const rows = [
    { title: 'Type-check + release build', ...row1 },
    { title: 'Full unit suite (+ flake protocol)', ...row2 },
    { title: 'Edge Function types (deno check)', ...row3 },
    { title: 'Guards: a11y lint, overlays, viewport, CSP, CLAUDE.md, demo-secret surface', ...row4 },
    { title: 'Touched browser specs, run whole', ...row5 },
  ]
  meta.go = rows.every((r) => r.status !== 'fail')

  const md = report(meta, rows, flakes)
  writeFileSync(join(workdir, 'gate-report.md'), md)
  writeFileSync(join(workdir, 'gate-report.json'), JSON.stringify({ ...meta, rows, flakes }, null, 2))
  console.log(`\n${md}\n`)
  for (const row of rows) {
    for (const s of row.steps ?? []) if (!s.ok) console.log(`--- ${s.name} (tail of .gate-logs/${s.name}.log) ---\n${s.tail}\n`)
  }
  console.log(`gate: report at ${join(workdir, 'gate-report.md')}`)
  process.exit(meta.go ? 0 : 1)
}

main()
