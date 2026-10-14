// Forbidden moves: the ways a change gets to green without being right. Pure —
// takes a unified diff (git diff base..tip) and, for the JSON baselines whose
// meaning a line diff cannot show, a reader for each side.
//
// A move is reported, never silently allowed. A brief may allow one, with a
// reason, but only if the allowance was in the brief's FIRST commit — before
// any code (applyAllowances). The same rule as config/knownFlakes.json: a
// change cannot excuse itself after seeing it is red.

export const MOVES = [
  'removed-assertion', // an expect/assert removed from a test, not put back
  'skip-only', // .skip / .only / .todo / xit / skipIf / fixme added
  'timeout-raised', // a test or config timeout raised
  'flake-listed', // a new config/knownFlakes.json entry
  'suppression-added', // eslint-suppressions / grant / overlay baseline grew
  'edit-gate-scripts', // the gate, the brief checker, CI, the gate agent
  'edit-test-config', // vitest / playwright config
  'deploy-or-push', // a script that pushes, deploys or targets the tenant
]

const TEST_FILE = /(^|\/)(__tests__|tests)\/|\.(test|spec)\.[cm]?[jt]sx?$/
const ASSERTION = /\b(expect|assert)\s*[.(]|\bexpect\w*\s*\(/
const SKIP = /\b(it|test|describe|suite)\.(skip|only|todo|fixme|skipIf|runIf)\b|\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(/
// `timeout: N` anywhere, or a bare trailing N as a test's last argument
// (`it('x', fn, 20000)`) — but not a timer's delay.
const TIMEOUT_VALUE = /\b(?:testTimeout|hookTimeout|timeout)\s*[:=]\s*([\d_]+)/g
const TRAILING_ARG = /,\s*([\d_]{4,})\s*\)\s*;?\s*$/
const TIMER = /\bset(Timeout|Interval)\s*\(|\bsleep\s*\(/
const GATE_FILES = [
  /^scripts\/gate[\w.-]*\.mjs$/,
  /^scripts\/check-brief\.mjs$/,
  /^scripts\/lib\/(flakeVerdict|failureKeys|brief|forbiddenMoves|failFirstVerdict)\.mjs$/,
  /^\.github\/workflows\//,
  /^\.claude\/agents\/gate\.md$/,
]
const TEST_CONFIG = /^(vitest|playwright)[\w.-]*\.config\.[cm]?[jt]s$/
const PUSH_OR_TENANT = /\bgit push\b|--env=amadiya\b|\bdeploy:amadiya\b|\bvercel\s+(deploy|--prod)\b|"deploy:[\w-]+"\s*:/
const SCRIPTISH = /^(package\.json$|scripts\/|supabase\/ops\/|\.github\/)/

/** @returns {{ path: string, status: 'added'|'deleted'|'modified', added: string[], removed: string[] }[]} */
export function parseDiff(diff) {
  const files = []
  let cur = null
  for (const line of diff.replace(/\r\n/g, '\n').split('\n')) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
    if (head) {
      cur = { path: head[2], status: 'modified', added: [], removed: [], inHunk: false }
      files.push(cur)
      continue
    }
    if (!cur) continue
    if (!cur.inHunk) {
      if (line.startsWith('new file mode')) cur.status = 'added'
      else if (line.startsWith('deleted file mode')) cur.status = 'deleted'
      else if (line.startsWith('@@')) cur.inHunk = true
      continue
    }
    if (line.startsWith('@@')) continue
    if (line.startsWith('+')) cur.added.push(line.slice(1))
    else if (line.startsWith('-')) cur.removed.push(line.slice(1))
  }
  return files.map(({ inHunk: _, ...f }) => f)
}

const count = (lines, re) => lines.filter((l) => re.test(l)).length

const num = (text) => Number(text.replaceAll('_', ''))

function timeouts(lines) {
  return lines.flatMap((l) => {
    const named = [...l.matchAll(TIMEOUT_VALUE)].map((m) => num(m[1]))
    const trailing = TIMER.test(l) ? null : TRAILING_ARG.exec(l)
    return trailing ? [...named, num(trailing[1])] : named
  })
}

const safeJson = (text) => {
  try {
    return text == null ? null : JSON.parse(text)
  } catch {
    return null
  }
}

function suppressionTotal(json) {
  let total = 0
  for (const rules of Object.values(json ?? {})) for (const r of Object.values(rules ?? {})) total += Number(r?.count ?? 0)
  return total
}

// The JSON baselines are judged on their meaning, not their lines: a pruned
// suppression file rewrites lines while shrinking.
function baselineMoves(f, before, after) {
  if (f.path === 'config/knownFlakes.json') {
    const was = new Set((safeJson(before(f.path)) ?? []).map((k) => k?.file))
    const added = (safeJson(after(f.path)) ?? []).map((k) => k?.file).filter((file) => !was.has(file))
    return added.map((file) => ({ move: 'flake-listed', file: f.path, detail: `lists ${file}` }))
  }
  if (f.path === 'eslint-suppressions.json') {
    const b = suppressionTotal(safeJson(before(f.path)))
    const a = suppressionTotal(safeJson(after(f.path)))
    return a > b ? [{ move: 'suppression-added', file: f.path, detail: `suppressions ${b} → ${a}` }] : []
  }
  if (f.path === 'components/overlay-baseline.json') {
    const b = safeJson(before(f.path))?.files?.length ?? 0
    const a = safeJson(after(f.path))?.files?.length ?? 0
    return a > b ? [{ move: 'suppression-added', file: f.path, detail: `overlay exemptions ${b} → ${a}` }] : []
  }
  if (f.path === 'config/grantBaseline.mjs' && f.added.length > 0) {
    return [{ move: 'suppression-added', file: f.path, detail: 'grant baseline edited — it may only shrink' }]
  }
  return []
}

function testMoves(f) {
  const moves = []
  const lost = count(f.removed, ASSERTION) - count(f.added, ASSERTION)
  if (lost > 0) moves.push({ move: 'removed-assertion', file: f.path, detail: `${lost} assertion line(s) removed` })
  const skips = f.added.filter((l) => SKIP.test(l))
  if (skips.length > 0) moves.push({ move: 'skip-only', file: f.path, detail: skips[0].trim() })
  return moves
}

function timeoutMoves(f) {
  const ceiling = Math.max(0, ...timeouts(f.removed))
  const raised = timeouts(f.added).filter((t) => t > ceiling)
  return raised.length > 0 ? [{ move: 'timeout-raised', file: f.path, detail: `timeout ${ceiling || 'default'} → ${Math.max(...raised)}` }] : []
}

/**
 * @param {string} diff  unified diff, base..tip
 * @param {{ before?: (path: string) => string|null, after?: (path: string) => string|null }} [read]
 * @returns {{ move: string, file: string, detail: string }[]}
 */
export function findForbiddenMoves(diff, { before = () => null, after = () => null } = {}) {
  const moves = []
  for (const f of parseDiff(diff)) {
    const isTest = TEST_FILE.test(f.path)
    if (isTest) moves.push(...testMoves(f))
    if (isTest || TEST_CONFIG.test(f.path)) moves.push(...timeoutMoves(f))
    if (TEST_CONFIG.test(f.path)) moves.push({ move: 'edit-test-config', file: f.path, detail: f.status })
    if (GATE_FILES.some((re) => re.test(f.path))) moves.push({ move: 'edit-gate-scripts', file: f.path, detail: f.status })
    moves.push(...baselineMoves(f, before, after))
    const pushes = SCRIPTISH.test(f.path) ? f.added.filter((l) => PUSH_OR_TENANT.test(l)) : []
    if (pushes.length > 0) moves.push({ move: 'deploy-or-push', file: f.path, detail: pushes[0].trim() })
  }
  return moves
}

/**
 * An allowance counts only if it was in the brief as approved (its first
 * commit, before any code). One added later is reported and excuses nothing.
 */
export function applyAllowances(moves, { atApproval, atTip }) {
  return moves.map((m) => {
    const approved = atApproval.find((a) => a.move === m.move)
    if (approved) return { ...m, blocking: false, allowedBecause: approved.reason }
    if (atTip.some((a) => a.move === m.move)) return { ...m, blocking: true, note: 'allowance added after approval — excuses nothing' }
    return { ...m, blocking: true }
  })
}

// Paths that cannot change what runs: prose, images, the agent/skill prompts.
const NOT_CODE = [/\.md$/i, /^docs\//, /\.(png|jpe?g|gif|webp|svg)$/i]

/** The touched paths that ARE code. An empty failFirst is legal only when this is empty. */
export function touchesCode(paths) {
  return paths.filter((p) => !NOT_CODE.some((re) => re.test(p)))
}
