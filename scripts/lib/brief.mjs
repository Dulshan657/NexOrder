// The brief: what a change sets out to prove, written and approved BEFORE any
// code (docs/claude/briefs.md). Pure — scripts/check-brief.mjs does the git and
// the test runs; this only reads text.
//
// A brief is markdown whose machine-readable half is one ```json brief``` block
// (strict JSON: the repo carries no YAML parser, and a brief is a contract, so
// an ambiguous one is refused rather than guessed at). Everything after
// `## FINAL` is the author's closing report, written last.

import { MOVES } from './forbiddenMoves.mjs'

const KEYS = ['id', 'base', 'approved', 'acceptance', 'failFirst', 'allow']
const REQUIRED = ['id', 'base', 'approved', 'acceptance', 'failFirst']
const ACCEPTANCE_KEYS = ['id', 'check', 'manual']
const FAIL_FIRST_KEYS = ['file', 'test', 'proves']
const ALLOW_KEYS = ['move', 'reason']
const FINAL_HEADING = /^## FINAL[ \t]*$/m
const BLOCK = /```json brief[ \t]*\r?\n([\s\S]*?)\r?\n```/

const isText = (v) => typeof v === 'string' && v.trim() !== ''

function unknownKeys(obj, allowed, where) {
  return Object.keys(obj).filter((k) => !allowed.includes(k)).map((k) => `${where}unknown key "${k}"`)
}

function checkAcceptance(acceptance, errors) {
  if (!Array.isArray(acceptance) || acceptance.length === 0) return errors.push('acceptance must be a non-empty list')
  const seen = new Set()
  for (const a of acceptance) {
    errors.push(...unknownKeys(a, ACCEPTANCE_KEYS, `acceptance ${a.id ?? '?'}: `))
    if (!/^A\d+$/.test(a.id ?? '')) errors.push(`acceptance id must look like A1, got ${JSON.stringify(a.id)}`)
    if (!isText(a.check)) errors.push(`acceptance ${a.id}: "check" must say what is checked`)
    if (a.manual !== undefined && !isText(a.manual)) errors.push(`acceptance ${a.id}: "manual" must say how it is verified`)
    if (seen.has(a.id)) errors.push(`duplicate acceptance id ${a.id}`)
    seen.add(a.id)
  }
}

function checkFailFirst(failFirst, ids, errors) {
  if (!Array.isArray(failFirst)) return errors.push('failFirst must be a list (empty only for a diff touching no code)')
  for (const f of failFirst) {
    errors.push(...unknownKeys(f, FAIL_FIRST_KEYS, `failFirst "${f.test ?? '?'}": `))
    if (!/\.test\.tsx?$/.test(f.file ?? '')) errors.push(`failFirst file ${f.file} is not a *.test.ts(x) file`)
    if (!isText(f.test)) errors.push(`failFirst in ${f.file}: "test" must be the full name, "suite > test"`)
    if (!Array.isArray(f.proves) || f.proves.length === 0) errors.push(`failFirst "${f.test}" must prove at least one acceptance id`)
    for (const id of f.proves ?? []) {
      if (!ids.has(id)) errors.push(`failFirst "${f.test}" proves ${id}, which is not an acceptance id`)
    }
  }
}

function checkAllow(allow, errors) {
  if (!Array.isArray(allow)) return errors.push('allow must be a list')
  for (const a of allow) {
    errors.push(...unknownKeys(a, ALLOW_KEYS, 'allow: '))
    if (!MOVES.includes(a.move)) errors.push(`allow: unknown move "${a.move}"`)
    else if (!isText(a.reason)) errors.push(`allow: "${a.move}" needs a reason`)
  }
}

/**
 * @param {string} md  the brief file
 * @returns {{ brief: object|null, errors: string[] }}
 */
export function parseBrief(md) {
  const block = BLOCK.exec(md)
  if (!block) return { brief: null, errors: ['no ```json brief``` block at the top of the brief'] }
  let raw
  try {
    raw = JSON.parse(block[1])
  } catch (e) {
    return { brief: null, errors: [`the json brief block is not valid JSON: ${e.message}`] }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { brief: null, errors: ['the json brief block must be an object'] }

  const errors = unknownKeys(raw, KEYS, '')
  for (const k of REQUIRED) if (raw[k] === undefined) errors.push(`missing "${k}"`)
  if (raw.id !== undefined && !/^NX-\d{4}-[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.id)) errors.push('id must look like NX-0001-some-slug')
  if (raw.base !== undefined && !/^[0-9a-f]{40}$/.test(raw.base)) errors.push('base must be a full 40-character commit sha')
  if (raw.approved !== undefined && !isText(raw.approved)) errors.push('approved must say when and by whom')

  const brief = { ...raw, allow: raw.allow ?? [] }
  checkAcceptance(brief.acceptance, errors)
  const ids = new Set((Array.isArray(brief.acceptance) ? brief.acceptance : []).map((a) => a.id))
  checkFailFirst(brief.failFirst, ids, errors)
  checkAllow(brief.allow, errors)

  if (Array.isArray(brief.acceptance) && Array.isArray(brief.failFirst)) {
    const proved = new Set(brief.failFirst.flatMap((f) => f.proves ?? []))
    for (const a of brief.acceptance) {
      if (!proved.has(a.id) && a.manual === undefined) errors.push(`${a.id} is proved by no failFirst test and has no "manual" note`)
    }
  }
  return { brief: errors.length === 0 ? brief : null, errors }
}

/** Everything before `## FINAL` — what the owner approved. Writing FINAL is not a revision. */
export function briefBody(md) {
  const m = FINAL_HEADING.exec(md)
  return (m ? md.slice(0, m.index) : md).replace(/\r\n/g, '\n').trimEnd()
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

/**
 * The author's closing report: one table row per acceptance id
 * (`| A1 | claimed | evidence | note |`) and a `### Not claimed` list.
 */
export function parseFinal(md) {
  const m = FINAL_HEADING.exec(md)
  const text = m ? md.slice(m.index + m[0].length).replace(/\r\n/g, '\n') : ''
  const [tablePart, notClaimedPart = null] = text.split(/^### Not claimed[ \t]*$/m)
  const rows = tablePart
    .split('\n')
    .filter((l) => /^\s*\|/.test(l))
    .map(cells)
    .filter(([id]) => /^A\d+$/.test(id))
    .map(([id, status = '', evidence = '', note = '']) => ({ id, status, evidence, note }))
  const notClaimed = notClaimedPart === null
    ? null
    : notClaimedPart.split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
  return { present: rows.length > 0 || (notClaimed?.length ?? 0) > 0, rows, notClaimed: notClaimed ?? [] }
}

/** @returns {string[]} errors; empty means every acceptance id is accounted for. */
export function checkFinal(brief, final) {
  if (!final.present) return ['FINAL is empty — write it before asking for the gate']
  const errors = []
  const ids = new Set(brief.acceptance.map((a) => a.id))
  const seen = new Set()
  for (const r of final.rows) {
    if (seen.has(r.id)) errors.push(`${r.id} appears twice in FINAL`)
    seen.add(r.id)
    if (!ids.has(r.id)) errors.push(`FINAL names ${r.id}, which is not an acceptance id`)
    if (r.status !== 'claimed' && r.status !== 'not-claimed') errors.push(`${r.id}: status must be claimed or not-claimed, got "${r.status}"`)
    else if (r.status === 'claimed' && !isText(r.evidence)) errors.push(`${r.id} is claimed with no evidence`)
  }
  for (const id of ids) if (!seen.has(id)) errors.push(`FINAL does not account for ${id}`)
  if (final.notClaimed.length === 0) errors.push('FINAL needs a "### Not claimed" list with at least one item')
  return errors
}
