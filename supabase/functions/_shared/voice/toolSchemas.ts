// Nex Assistant (voice) - the tool contract the model is offered.
//
// PURE: imported by BOTH the voice-session Edge Function (Deno), which mints the
// session with these schemas, and the browser (Vite), whose runVoiceTool checks
// every call against toolsForRole. No Deno globals, no URL or npm imports,
// relative imports carry .ts (pinned by __tests__/wie/purity.test.ts).
//
// toolsForRole is the ONE permission source of truth: the server offers exactly
// this list, and the browser refuses anything outside it. Never compare a role
// to a literal anywhere else to decide what the assistant may call.

// The role lists live in roles.ts (import-free) so the browser's launcher gate
// can read them without pulling every tool definition into the entry chunk.
import { REP_ROLES, VOICE_ROLES } from './roles.ts'
export { REP_ROLES, VOICE_ROLES }

export const VOICE_TOOL_NAMES = [
  'get_sales_summary',
  'get_target_progress',
  'get_follow_up_list',
  'find_customer',
  'get_customer_insights',
  'get_suggested_order_for_customer',
  'get_stock_status',
  'get_reorder_recommendations',
  'get_product_movement',
  'get_visit_stats',
] as const

export type VoiceToolName = (typeof VOICE_TOOL_NAMES)[number]

export interface VoiceToolSchema {
  type: 'function'
  name: VoiceToolName
  description: string
  parameters: Record<string, unknown>
}

const WAREHOUSE_TOOLS: readonly VoiceToolName[] = [
  'get_stock_status',
  'get_reorder_recommendations',
  'get_product_movement',
]

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

function defineTool(
  name: VoiceToolName,
  description: string,
  properties: Record<string, unknown>,
  required: readonly string[],
): VoiceToolSchema {
  return {
    type: 'function',
    name,
    description,
    parameters: { type: 'object', properties, required: [...required], additionalProperties: false },
  }
}

function limitProperty(defaultValue: number): Record<string, unknown> {
  return {
    type: 'integer',
    minimum: 1,
    maximum: 15,
    default: defaultValue,
    description: 'How many rows to return, 1 to 15.',
  }
}

const horecaIdProperty = {
  horeca_id: { type: 'integer', description: 'Customer id from find_customer.' },
}

const SALES_SUMMARY = defineTool(
  'get_sales_summary',
  'Revenue, order count, average order value, new customers, orders by status, top 5 customers and top 5 products for a period, with the previous period for comparison. For sales reps the scope is always their own orders. Set horeca_id to scope to one customer (resolve it with find_customer first).',
  {
    period: {
      type: 'string',
      enum: ['today', 'this_week', 'this_month', 'last_month', 'last_30_days', 'custom'],
      description: 'The period to summarise. Use custom only together with from and to.',
    },
    from: { type: 'string', description: 'First day as YYYY-MM-DD. Only with period custom.' },
    to: { type: 'string', description: 'Last day as YYYY-MM-DD. Only with period custom.' },
    compare_previous: {
      type: 'boolean',
      default: true,
      description: 'Also return the previous period for comparison.',
    },
    horeca_id: {
      type: 'integer',
      description: 'Customer id from find_customer. Leave out for all customers.',
    },
  },
  ['period'],
)

const TARGET_PROGRESS = defineTool(
  'get_target_progress',
  "The caller's active sales targets with achieved value, percent, days remaining and a pace projection (on track, behind, at risk). Managers and admins get a per-rep summary (max 10).",
  {},
  [],
)

const FOLLOW_UP_LIST = defineTool(
  'get_follow_up_list',
  'Customers worth contacting now, most urgent first: overdue for their usual reorder, declining, or at risk, each with the reason, days since last order and last visit date. Reps see only customers they have sold to.',
  { limit: limitProperty(8) },
  [],
)

const FIND_CUSTOMER = defineTool(
  'find_customer',
  'Fuzzy-match a customer (HoReCa venue) by name. Returns up to 5 candidates with id, name and address, and ambiguous=true when more than one is a strong match. Call this before any tool that needs horeca_id unless the id is already known from this conversation. If ambiguous, ask the user which one.',
  { query: { type: 'string', description: 'The customer name as the user said it.' } },
  ['query'],
)

const CUSTOMER_INSIGHTS = defineTool(
  'get_customer_insights',
  "One customer's buying pattern: segment, total orders and spend, average days between orders, predicted next order date, days since last order, spend trend, and their top products with whether each is overdue.",
  horecaIdProperty,
  ['horeca_id'],
)

const SUGGESTED_ORDER = defineTool(
  'get_suggested_order_for_customer',
  'A suggested next order for one customer from what they usually buy and how often: product, usual quantity, days since they last bought it, overdue flag. Advisory only; the user places it in the app.',
  horecaIdProperty,
  ['horeca_id'],
)

const STOCK_STATUS = defineTool(
  'get_stock_status',
  'Warehouse stock. summary: in-stock, low and out-of-stock counts plus total on-hand and available units. low / out: the products (max 15) with on-hand, available, threshold and category.',
  {
    filter: {
      type: 'string',
      enum: ['summary', 'low', 'out'],
      description: 'summary for counts, low or out for the products themselves.',
    },
    category: { type: 'string', description: 'Only this product category. Optional.' },
  },
  ['filter'],
)

const REORDER_RECOMMENDATIONS = defineTool(
  'get_reorder_recommendations',
  'Products the warehouse should reorder from suppliers: out of stock but selling, or running out within the supplier lead time at the current weekly rate; with on-hand, weekly rate, days remaining and a suggested quantity covering lead time plus two weeks. Managers and admins only.',
  {
    lead_time_days: {
      type: 'integer',
      minimum: 1,
      maximum: 60,
      default: 14,
      description: 'Supplier lead time in days, 1 to 60.',
    },
    limit: limitProperty(10),
  },
  [],
)

const PRODUCT_MOVEMENT = defineTool(
  'get_product_movement',
  'Product velocity over the last 90 days: top movers, slow movers, or dead stock (in stock, not sold for 30 days).',
  {
    kind: {
      type: 'string',
      enum: ['top', 'slow', 'dead'],
      description: 'top movers, slow movers, or dead stock.',
    },
    limit: limitProperty(10),
  },
  ['kind'],
)

const VISIT_STATS = defineTool(
  'get_visit_stats',
  "A field rep's own visits for the period: planned, completed, skipped, completion rate, and how many visits produced an order.",
  {
    period: {
      type: 'string',
      enum: ['this_week', 'this_month', 'last_month'],
      description: 'The period to report on.',
    },
  },
  ['period'],
)

/** Every tool, in the order VOICE_TOOL_NAMES declares. Deeply frozen. */
export const VOICE_TOOLS: readonly VoiceToolSchema[] = deepFreeze([
  SALES_SUMMARY,
  TARGET_PROGRESS,
  FOLLOW_UP_LIST,
  FIND_CUSTOMER,
  CUSTOMER_INSIGHTS,
  SUGGESTED_ORDER,
  STOCK_STATUS,
  REORDER_RECOMMENDATIONS,
  PRODUCT_MOVEMENT,
  VISIT_STATS,
])

function isOffered(name: VoiceToolName, role: string, modules: readonly string[]): boolean {
  if (name === 'get_reorder_recommendations' && REP_ROLES.includes(role)) return false
  if (WAREHOUSE_TOOLS.includes(name) && !modules.includes('inventory_dispatch')) return false
  if (name === 'get_visit_stats') {
    return role === 'Field Sales Rep' && modules.includes('field_ops')
  }
  return true
}

/**
 * The tools this role may use in a tenant with these modules enabled.
 *
 * `modules` are enabled module SLUGS (e.g. 'inventory_dispatch'). A role outside
 * VOICE_ROLES is offered nothing: the Edge Function already refuses it, and this
 * keeps the permission source of truth closed if it is ever reached anyway.
 */
export function toolsForRole(role: string, modules: readonly string[]): readonly VoiceToolSchema[] {
  if (!VOICE_ROLES.includes(role)) return []
  return VOICE_TOOLS.filter((tool) => isOffered(tool.name, role, modules))
}
