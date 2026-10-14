#!/usr/bin/env node
// The brief check: one exact change, judged against the brief it carries
// (docs/claude/briefs.md). Used three ways, always the same code:
//   - CI, job `brief · fail-first` — required on main, so it binds;
//   - the gate, row 6 (scripts/gate.mjs) — run from the GATE's checkout;
//   - locally before pushing: `npm run check:brief`.
//
// It checks, in order:
//   1. exactly one brief (docs/briefs/NX-####-*.md) is added by the change;
//   2. it parses strictly (scripts/lib/brief.mjs);
//   3. it was committed FIRST and ALONE, on top of the commit it names as
//      `base` — the owner approved it before any code existed — and any later
//      edit to it (outside FINAL) is a brief-only commit, listed as a revision;
//   4. no forbidden move (scripts/lib/forbiddenMoves.mjs) unless the brief AS
//      APPROVED allows it;
//   5. an empty failFirst only for a diff touching no code;
//   6. FAIL-FIRST: each named test, the tip's copy, fails on the base and
//      passes on the tip (scripts/lib/failFirstVerdict.mjs);
//   7. FINAL accounts for every acceptance id and says what is not claimed.
//
// Usage:
//   node scripts/check-brief.mjs [--base=origin/main] [--head=HEAD] [--repo=<checkout at head>]
//                                [--md=<report.md>] [--json=<report.json>]
// Exit: 0 = pass, 1 = fail, 2 = could not run.

import { existsSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { briefBody, checkFinal, parseBrief, parseFinal } from './lib/brief.mjs'
import { judgeFailFirst, testOutcome } from './lib/failFirstVerdict.mjs'
import { applyAllowances, findForbiddenMoves, touchesCode } from './lib/forbiddenMoves.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// This checker's own reporter, by absolute path — the base predates it.
const REPORTER = join(HERE, 'gate-reporter.mjs')
const BRIEF_PATH = /^docs\/briefs\/NX-\d{4}-[^/]+\.md$/

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

function die(message) {
  console.error(`check-brief: ${message}`)
  process.exit(2)
}

// Same quoting rules as scripts/gate.mjs: Windows needs a shell for npx, and
// cmd.exe expands %VAR% even inside quotes.
const SAFE_ARG = /^[\w@+=:,./\\~^-]+$/
const winQuote = (a) => {
  if (a.includes('%')) die(`refusing an argument containing '%': ${a}`)
  return SAFE_ARG.test(a) ? a : `"${a.replaceAll('"', '""')}"`
}

function sh(argv, { cwd, env } = {}) {
  const options = { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  const r = process.platform === 'win32'
    ? spawnSync(argv.map(winQuote).join(' '), { ...options, shell: true })
    : spawnSync(argv[0], argv.slice(1), options)
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' }
}

function makeGit(repo) {
  const git = (args) => {
    const r = sh(['git', ...args], { cwd: repo })
    if (!r.ok) die(`git ${args.join(' ')} failed:\n${r.err}${r.out}`)
    return r.out.replace(/\s+$/, '')
  }
  const show = (rev, path) => {
    const r = sh(['git', 'show', `${rev}:${path}`], { cwd: repo })
    return r.ok ? r.out : null
  }
  const lines = (args) => git(args).split('\n').filter(Boolean)
  return { git, show, lines }
}

function findBrief(lines, base, head) {
  const added = lines(['diff', '--name-only', '--diff-filter=A', base, head, '--', 'docs/briefs']).filter((p) => BRIEF_PATH.test(p))
  if (added.length === 1) return { path: added[0] }
  return {
    error: added.length === 0
      ? 'no brief: the change must add exactly one docs/briefs/NX-####-<slug>.md (use /brief)'
      : `${added.length} briefs added (${added.join(', ')}) — one change, one brief`,
  }
}

// The brief must be the change's FIRST commit, touching nothing else, sitting
// on the commit it names as `base`: that is what "approved before any code"
// means mechanically.
function checkApproval({ git, lines }, path, base, head, brief) {
  const errors = []
  const first = lines(['log', '--reverse', '--format=%H', '--diff-filter=A', `${base}..${head}`, '--', path])[0]
  if (!first) return { errors: [`cannot find the commit that added ${path}`], first: null }
  const files = lines(['diff-tree', '--no-commit-id', '--name-only', '-r', first])
  if (files.length !== 1 || files[0] !== path) errors.push(`the brief's commit ${first.slice(0, 10)} also touches ${files.filter((f) => f !== path).join(', ')} — commit the brief alone`)
  const before = lines(['rev-list', `${base}..${first}^`])
  if (before.length > 0) errors.push(`${before.length} commit(s) precede the brief (${before.map((s) => s.slice(0, 10)).join(', ')}) — the brief comes before any code`)
  const parent = git(['rev-parse', `${first}^`])
  if (brief && brief.base !== parent) errors.push(`brief.base is ${brief.base.slice(0, 10)} but the brief was committed on ${parent.slice(0, 10)}`)
  return { errors, first }
}

// Every later commit that changes the approved body (anything above FINAL) is
// a revision. It is legal only as a brief-only commit, and always reported.
function checkRevisions({ git, show, lines }, path, base, head, first) {
  const errors = []
  const revisions = []
  const commits = lines(['log', '--first-parent', '--format=%H', `${base}..${head}`, '--', path]).filter((c) => c !== first)
  for (const c of commits.reverse()) {
    const now = show(c, path)
    const was = show(`${c}^`, path)
    if (now === null || was === null || briefBody(now) === briefBody(was)) continue
    const files = lines(['diff-tree', '--no-commit-id', '--name-only', '-r', c])
    const briefOnly = files.length === 1 && files[0] === path
    revisions.push({ sha: c, subject: git(['log', '-1', '--format=%s', c]), briefOnly })
    if (!briefOnly) errors.push(`commit ${c.slice(0, 10)} edits the approved brief together with code — revise the brief in a commit of its own`)
  }
  return { errors, revisions }
}

function vitestReport(cwd, files, out) {
  rmSync(out, { force: true })
  const r = sh(['npx', 'vitest', 'run', ...files, '--reporter=default', `--reporter=${REPORTER}`], {
    cwd,
    env: { GATE_REPORT_OUT: out },
  })
  return { ok: r.ok, log: `${r.out}${r.err}`, report: existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null }
}

function removeLink(path) {
  try {
    unlinkSync(path)
  } catch {
    rmdirSync(path)
  }
}

// The tip's copy of each named test, run against the BASE's code, in a
// throwaway worktree outside every checkout. node_modules is linked from the
// tip's checkout (a junction on Windows), never installed.
function runOnBase({ git }, repo, base, head, files, scratch) {
  const dir = mkdtempSync(join(tmpdir(), 'nexorder-failfirst-'))
  rmSync(dir, { recursive: true, force: true })
  git(['worktree', 'add', '--quiet', '--detach', dir, base])
  const link = join(dir, 'node_modules')
  try {
    const co = sh(['git', 'checkout', head, '--', ...files], { cwd: dir })
    if (!co.ok) die(`could not place the tip's tests on the base:\n${co.err}`)
    symlinkSync(join(repo, 'node_modules'), link, 'junction')
    return vitestReport(dir, files, join(scratch, 'failfirst-base.json'))
  } finally {
    if (existsSync(link)) removeLink(link)
    sh(['git', 'worktree', 'remove', '--force', dir], { cwd: repo })
    rmSync(dir, { recursive: true, force: true })
    sh(['git', 'worktree', 'prune'], { cwd: repo })
  }
}

function failFirst(ctx, repo, base, head, brief, scratch) {
  const files = [...new Set(brief.failFirst.map((f) => f.file))]
  const tip = vitestReport(repo, files, join(scratch, 'failfirst-tip.json'))
  const onBase = runOnBase(ctx, repo, base, head, files, scratch)
  const notes = []
  if (ctx.show(base, 'package-lock.json') !== ctx.show(head, 'package-lock.json')) {
    notes.push('package-lock.json differs between base and tip: the base run used the TIP\'s node_modules.')
  }
  const results = brief.failFirst.map((f) => {
    const outcomes = { base: testOutcome(onBase.report, f.file, f.test), tip: testOutcome(tip.report, f.file, f.test) }
    return { ...f, ...outcomes, ...judgeFailFirst(outcomes) }
  })
  return { results, notes, logs: { tip: tip.log, base: onBase.log } }
}

function report(r) {
  const mark = (blocking) => (blocking ? '❌' : '✅')
  const lines = [`## Brief · fail-first — ${r.verdict}`, '', `- **Brief:** ${r.briefPath ?? '—'}`, `- **Base:** \`${r.base}\` → **head** \`${r.head}\``]
  if (r.errors.length > 0) lines.push('', '### Blocking', '', ...r.errors.map((e) => `- ${e}`))
  if (r.failFirst.length > 0) {
    lines.push('', '### Fail-first', '', '| Test | Base | Tip | Verdict |', '|---|---|---|---|')
    for (const f of r.failFirst) lines.push(`| \`${f.file}\` › ${f.test} | ${f.base} | ${f.tip} | ${mark(f.blocking)} ${f.verdict} |`)
  }
  if (r.moves.length > 0) {
    lines.push('', '### Forbidden moves', '', '| Move | File | Detail | |', '|---|---|---|---|')
    for (const m of r.moves) lines.push(`| ${m.move} | \`${m.file}\` | ${m.detail} | ${m.blocking ? `❌ ${m.note ?? 'not allowed by the approved brief'}` : `allowed: ${m.allowedBecause}`} |`)
  }
  if (r.revisions.length > 0) {
    lines.push('', '### Brief revisions after approval', '', ...r.revisions.map((v) => `- \`${v.sha.slice(0, 10)}\` ${v.subject}${v.briefOnly ? '' : ' — **mixed with code**'}`))
  }
  lines.push('', '### Not claimed (author)', '', ...(r.notClaimed.length > 0 ? r.notClaimed.map((n) => `- ${n}`) : ['- (FINAL has no list)']))
  if (r.notes.length > 0) lines.push('', '### Notes', '', ...r.notes.map((n) => `- ${n}`))
  return lines.join('\n')
}

function main() {
  const repo = resolve(arg('repo', process.cwd()))
  const ctx = makeGit(repo)
  const head = ctx.git(['rev-parse', '--verify', `${arg('head', 'HEAD')}~0`])
  const base = ctx.git(['merge-base', head, arg('base', 'origin/main')])
  if (ctx.git(['rev-parse', 'HEAD']) !== head) die(`${repo} is not checked out at ${head} — the tests run in that checkout`)
  if (ctx.git(['status', '--porcelain', '--untracked-files=no']) !== '') die(`${repo} has uncommitted changes — commit first; the check judges commits`)

  const r = { base, head, briefPath: null, errors: [], failFirst: [], moves: [], revisions: [], notClaimed: [], notes: [] }
  const found = findBrief(ctx.lines, base, head)
  if (found.error) r.errors.push(found.error)
  let brief = null
  if (found.path) {
    r.briefPath = found.path
    const md = readFileSync(join(repo, found.path), 'utf8')
    const parsed = parseBrief(md)
    brief = parsed.brief
    r.errors.push(...parsed.errors.map((e) => `brief: ${e}`))

    const approval = checkApproval(ctx, found.path, base, head, brief)
    r.errors.push(...approval.errors)
    if (approval.first) {
      const rev = checkRevisions(ctx, found.path, base, head, approval.first)
      r.errors.push(...rev.errors)
      r.revisions = rev.revisions
    }
    const approved = approval.first ? parseBrief(ctx.show(approval.first, found.path) ?? '').brief : null

    const diff = ctx.git(['diff', '--no-color', '--no-ext-diff', base, head])
    const moves = findForbiddenMoves(diff, { before: (p) => ctx.show(base, p), after: (p) => ctx.show(head, p) })
    r.moves = applyAllowances(moves, { atApproval: approved?.allow ?? [], atTip: brief?.allow ?? [] })
    r.errors.push(...r.moves.filter((m) => m.blocking).map((m) => `forbidden move ${m.move} in ${m.file}: ${m.detail}`))

    if (brief) {
      const code = touchesCode(ctx.lines(['diff', '--name-only', base, head]))
      if (brief.failFirst.length === 0 && code.length > 0) r.errors.push(`failFirst is empty but the change touches code: ${code.slice(0, 5).join(', ')}${code.length > 5 ? ' …' : ''}`)
      const final = parseFinal(md)
      r.notClaimed = final.notClaimed
      r.errors.push(...checkFinal(brief, final).map((e) => `FINAL: ${e}`))
      if (brief.failFirst.length > 0) {
        const scratch = mkdtempSync(join(tmpdir(), 'nexorder-brief-'))
        const ff = failFirst(ctx, repo, base, head, brief, scratch)
        r.failFirst = ff.results
        r.notes.push(...ff.notes)
        for (const f of ff.results) {
          if (f.verdict === 'proven-by-absence') r.notes.push(`${f.test}: the base could not load ${f.file} — proven by absence, not by an assertion.`)
          if (f.blocking) r.errors.push(`fail-first ${f.verdict}: ${f.file} › ${f.test} (base ${f.base}, tip ${f.tip})`)
        }
        const logs = arg('md') ? dirname(resolve(arg('md'))) : scratch
        writeFileSync(join(logs, 'failfirst-tip.log'), ff.logs.tip)
        writeFileSync(join(logs, 'failfirst-base.log'), ff.logs.base)
      }
    }
  }

  r.verdict = r.errors.length === 0 ? 'PASS' : 'FAIL'
  const md = report(r)
  if (arg('md')) writeFileSync(resolve(arg('md')), md)
  if (arg('json')) writeFileSync(resolve(arg('json')), JSON.stringify(r, null, 2))
  console.log(md)
  process.exit(r.errors.length === 0 ? 0 : 1)
}

main()
