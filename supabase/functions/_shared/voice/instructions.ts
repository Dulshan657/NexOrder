// Nex Assistant (voice) - the system prompt for a session.
//
// PURE: no Deno globals, no URL or npm imports. The Edge Function builds this at
// mint time; the text never goes back to the browser in a response.
//
// A section or line appears only when its condition holds, so the model is never
// told about a role it is not talking to or a module this tenant does not have.
// The whole prompt stays under MAX_INSTRUCTION_CHARS: it is paid for on every
// turn, and a long prompt also makes the model chattier.

export interface InstructionsInput {
  role: string
  name: string
  /** Today's date as the server saw it, e.g. 2026-10-20. */
  todayIso: string
  /** Enabled module slugs, e.g. ['sales_orders', 'inventory_dispatch']. */
  modules: readonly string[]
}

export const MAX_INSTRUCTION_CHARS = 4000

const MAX_NAME_CHARS = 80
const MAX_ROLE_CHARS = 40
const MAX_DATE_CHARS = 32

const REP_ROLES: readonly string[] = ['Field Sales Rep', 'Office Sales Rep']
const COMPANY_ROLES: readonly string[] = ['Admin', 'Manager']

/**
 * Collapse anything that could start a new line or section (newlines, control
 * characters) into single spaces and bound the length. The name comes from a
 * profile an admin typed, so it is data, not prompt.
 */
function oneLine(value: string, maxChars: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f\s]+/g, ' ')
    .trim()
    .slice(0, maxChars)
    .trim()
}

function header(name: string, role: string, todayIso: string): string {
  return [
    'You are Nex Assistant, the voice assistant inside Nex Order, a B2B ordering and',
    `warehouse app. You are talking to ${name}, whose role is ${role}. Today is ${todayIso}.`,
    'Amounts are Australian dollars. Speak English.',
  ].join('\n')
}

const HOW_TO_SPEAK = [
  'HOW TO SPEAK',
  '- This is a phone call. Answer in one to three short sentences, then stop. Offer',
  '  detail only if asked. Round money to whole dollars; say "about" for estimates.',
  '- Never read out more than five items unless asked. Say "and N more" instead.',
  "- Every answer says what it is based on, in a few words, using the tool's basis:",
  '  the period, whose orders, and the rule.',
  '- Call a tool before saying any number. If a tool returns nothing or an error, say',
  '  the data is not available. Never invent a number.',
].join('\n')

const CANNOT_DO = [
  'WHAT YOU CANNOT DO',
  '- You cannot place, change or cancel orders, move stock, send messages or change any',
  "  data. If asked, say you can't do that here and name the screen to use.",
  '- Only discuss Nex Order business data. Anything else is outside what you can help with.',
].join('\n')

const CUSTOMERS = [
  'CUSTOMERS',
  '- When the user names a customer, call find_customer first unless you already have the',
  '  id from this conversation. If ambiguous is true, ask which one before continuing.',
].join('\n')

const STYLE = [
  'STYLE',
  '- Warm, direct, no filler. Natural phrasing: "Three customers are overdue: Harbour Cafe,',
  '  Bayside Bistro and The Grove."',
].join('\n')

function repRules(name: string): string[] {
  return [
    `- Sales figures, targets and follow-ups are always ${name}'s own. Say "your", not`,
    `  "the company's". Warehouse reordering is a manager question; say so if asked.`,
  ]
}

const COMPANY_RULES = [
  '- Company-wide figures are fine. Per-rep figures come from',
  '  get_target_progress and get_sales_summary.',
]

const NO_WAREHOUSE_RULES = [
  '- There is no warehouse module here; do not offer stock or reorder answers.',
]

function roleRules(name: string, role: string, modules: readonly string[]): string[] {
  return [
    ...(REP_ROLES.includes(role) ? repRules(name) : []),
    ...(COMPANY_ROLES.includes(role) ? COMPANY_RULES : []),
    ...(modules.includes('inventory_dispatch') ? [] : NO_WAREHOUSE_RULES),
  ]
}

/**
 * The system prompt for one session. Pure and deterministic: the same input
 * always yields the same text, and it is always under MAX_INSTRUCTION_CHARS
 * because the free-text fields are bounded.
 */
export function buildInstructions(input: InstructionsInput): string {
  const name = oneLine(input.name, MAX_NAME_CHARS) || 'the user'
  const role = oneLine(input.role, MAX_ROLE_CHARS)
  const todayIso = oneLine(input.todayIso, MAX_DATE_CHARS)
  const rules = roleRules(name, role, input.modules)
  const sections = [
    header(name, role, todayIso),
    HOW_TO_SPEAK,
    CANNOT_DO,
    CUSTOMERS,
    ...(rules.length > 0 ? [['ROLE RULES', ...rules].join('\n')] : []),
    STYLE,
  ]
  return sections.join('\n\n')
}
