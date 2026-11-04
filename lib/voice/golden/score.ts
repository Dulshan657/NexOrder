// The golden scorer: does Nex's answer say what its tools said, and nothing else?
//
// A golden case (__tests__/voice/golden/questions.json) is a real question with
// what a right answer must contain, written as PATHS into the tool output rather
// than as numbers. The expected value is therefore whatever the data says on the
// day of the run, and a case never goes stale as dev's orders move.
//
// Four checks, each a problem string when it fails:
//   - every tool in `tools` was called;
//   - every fact in `states` ("tool.path.to.field", read from the LAST call of
//     that tool) appears in the answer;
//   - every number in the answer appears in some tool output or in the question
//     (whole-dollar rounding tolerated): Nex never does arithmetic of its own;
//   - a `refuse` case is declined, and an `avoids` pattern never appears.
//
// Pure: no IO. The live runner (scripts/nex-golden.mjs) collects the runs.

export interface GoldenCase {
  id: string
  role: string
  question: string
  /** Tools Nex must call. Required unless the case is a refusal. */
  tools?: string[]
  /** Facts the answer must state, as "tool_name.path.to.field" (array indexes allowed). */
  states?: string[]
  /** Nex cannot answer this today and must decline. */
  refuse?: boolean
  /** Regexes (case-insensitive) the answer must not match. */
  avoids?: string[]
  note?: string
}

export interface GoldenCall {
  name: string
  /** The function_call_output Nex was given: the parsed tool result. */
  output: unknown
}

export interface GoldenRun {
  answer: string
  /** The calls Nex made for THIS question. */
  calls: GoldenCall[]
  /** Calls from earlier questions in the same session: Nex may answer a follow-up from them. */
  earlierCalls?: GoldenCall[]
}

export interface GoldenScore {
  pass: boolean
  problems: string[]
  /** Facts that could not be checked because a list on their path was empty (no target this month). */
  unchecked?: string[]
}

const KNOWN_KEYS = new Set(['id', 'role', 'question', 'tools', 'states', 'refuse', 'avoids', 'note'])

// "can't", "cannot", "not able", "isn't available", "not available", "outside"...
const DECLINE = /\b(can['’]?t|cannot|can not|unable|not able|isn['’]t available|not available|don['’]t have|no access|outside)\b/i

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

function parseCase(raw: unknown, index: number): GoldenCase {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`golden case ${index} is not an object`)
  const c = raw as Record<string, unknown>
  const id = typeof c.id === 'string' && c.id ? c.id : `#${index}`
  const bad = (why: string): never => {
    throw new Error(`golden case ${id}: ${why}`)
  }
  for (const key of Object.keys(c)) if (!KNOWN_KEYS.has(key)) bad(`unknown key ${key}`)
  if (typeof c.id !== 'string' || !c.id) bad('id is required')
  if (typeof c.role !== 'string' || !c.role) bad('role is required')
  if (typeof c.question !== 'string' || !c.question) bad('question is required')
  for (const key of ['tools', 'states', 'avoids']) if (c[key] !== undefined && !isStringArray(c[key])) bad(`${key} must be a list of strings`)
  if (c.refuse !== undefined && typeof c.refuse !== 'boolean') bad('refuse must be true or false')
  const tools = (c.tools as string[] | undefined) ?? []
  if (c.refuse && (tools.length > 0 || c.states !== undefined)) bad('a refusal names no tools and states no facts')
  if (!c.refuse && tools.length === 0) bad('names no tool and is not a refusal')
  return c as unknown as GoldenCase
}

/** The cases from questions.json (`{ cases: [...] }`) or a bare list. Throws, naming the case, on anything malformed. */
export function parseGoldenCases(raw: unknown): GoldenCase[] {
  const list = Array.isArray(raw) ? raw : (raw as { cases?: unknown } | null)?.cases
  if (!Array.isArray(list)) throw new Error('golden questions: expected a list of cases')
  return list.map(parseCase)
}

/** Every number written in digits: "$4,225" is 4225, "62.5%" is 62.5. */
export function numbersIn(text: string): number[] {
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []
  return found.map((n) => Number(n.replace(/,/g, ''))).filter((n) => Number.isFinite(n))
}

function close(said: number, known: number): boolean {
  return Math.abs(said - known) <= 1 || said === Math.round(known)
}

const EMPTY_LIST = Symbol('empty list')

/**
 * The value at "a.b.0.c" inside `root`; undefined when a field is missing; EMPTY_LIST
 * when the path runs through an empty list. An empty list is a legitimate answer
 * ("no active targets"); a missing field is a tool that no longer returns it.
 */
function at(root: unknown, path: string[]): unknown {
  let node = root
  for (const key of path) {
    if (Array.isArray(node) && node.length === 0) return EMPTY_LIST
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

/** The data inside a tool result ({ ok, basis, data }), or the output itself. */
function dataOf(output: unknown): unknown {
  return output && typeof output === 'object' && 'data' in output ? (output as { data: unknown }).data : output
}

/** The latest call of `name`: this question's first, then the session's earlier ones. */
function lastCall(run: GoldenRun, name: string): GoldenCall | undefined {
  const latest = (calls: GoldenCall[]) => [...calls].reverse().find((c) => c.name === name)
  return latest(run.calls) ?? latest(run.earlierCalls ?? [])
}

/** "2026-10-17" spoken as "17 October", "October 17", "17 Oct" or the ISO form. */
function statesDate(answer: string, iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const day = String(Number(m[3]))
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return false
  const mon = `${month.slice(0, 3)}(?:${month.slice(3)})?`
  const spoken = new RegExp(`\\b${day}(?:st|nd|rd|th)?(?: of)? ${mon}\\b|\\b${mon} ${day}(?:st|nd|rd|th)?\\b`, 'i')
  return spoken.test(answer) || answer.includes(iso)
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']

/** A small count spoken as a word ("three orders"), and zero as "nothing", "no orders" or "none". */
function statesCountInWords(answer: string, value: number): boolean {
  if (value === 0 && /\b(no|none|nothing|zero)\b/i.test(answer)) return true
  const word = Number.isInteger(value) ? NUMBER_WORDS[value] : undefined
  return word !== undefined && new RegExp(`\\b${word}\\b`, 'i').test(answer)
}

function statesValue(answer: string, value: unknown): boolean {
  if (typeof value === 'number') return numbersIn(answer).some((n) => close(n, value)) || statesCountInWords(answer, value)
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return statesDate(answer, value)
    return answer.toLowerCase().includes(value.toLowerCase())
  }
  return false
}

function checkFact(run: GoldenRun, fact: string): { problem?: string; unchecked?: true } {
  const [tool, ...path] = fact.split('.')
  const call = lastCall(run, tool)
  if (!call) return {} // reported once as a missing call
  const value = at(dataOf(call.output), path)
  if (value === EMPTY_LIST) return { unchecked: true }
  if (value === undefined || value === null) return { problem: `${fact} is not in the tool output` }
  return statesValue(run.answer, value) ? {} : { problem: `did not state ${fact} (${String(value)})` }
}

// "and 2 more" is a count the instructions ask for ("Say \"and N more\" instead"),
// worked out from a list the tool returned; it is not a figure of its own.
const AND_N_MORE = /\band \d+ more\b/gi

function groundingProblems(c: GoldenCase, run: GoldenRun): string[] {
  const calls = [...run.calls, ...(run.earlierCalls ?? [])]
  const known = [...numbersIn(c.question), ...calls.flatMap((call) => numbersIn(JSON.stringify(call.output ?? null)))]
  return numbersIn(run.answer.replace(AND_N_MORE, ''))
    .filter((n) => !known.some((k) => close(n, k)))
    .map((n) => `ungrounded number: ${n}`)
}

export function scoreGoldenCase(c: GoldenCase, run: GoldenRun): GoldenScore {
  const problems: string[] = []
  const unchecked: string[] = []
  for (const tool of c.tools ?? []) if (!lastCall(run, tool)) problems.push(`did not call ${tool}`)
  for (const fact of c.states ?? []) {
    const result = checkFact(run, fact)
    if (result.problem) problems.push(result.problem)
    if (result.unchecked) unchecked.push(fact)
  }
  problems.push(...groundingProblems(c, run))
  if (c.refuse && !DECLINE.test(run.answer)) problems.push('answered a question it must refuse')
  for (const pattern of c.avoids ?? []) if (new RegExp(pattern, 'i').test(run.answer)) problems.push(`said what it must avoid: /${pattern}/`)
  return { pass: problems.length === 0, problems, ...(unchecked.length > 0 ? { unchecked } : {}) }
}
