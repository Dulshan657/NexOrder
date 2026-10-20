// What the model may pass to each tool, as zod schemas.
//
// Mirrors supabase/functions/_shared/voice/toolSchemas.ts, the JSON schemas the
// model is OFFERED. That file says what the model is told it may send; this one
// is what the browser actually accepts, and __tests__/voice/toolArgs.test.ts pins
// that the two agree on property names, required lists, enums, bounds and
// defaults. Every schema is strict: a property the contract does not define (a
// `rep_id`, say) is refused, not ignored, so the model learns it cannot ask.
//
// Two exports because the custom-date rule is a refinement, and a refined zod
// schema is no longer an object whose shape can be compared:
//   TOOL_ARG_OBJECTS  the plain strict objects, for comparison and inference
//   TOOL_ARG_SCHEMAS  what runVoiceTool parses with (objects plus the refinement)

import { z } from 'zod'
import type { VoiceToolName } from '@/supabase/functions/_shared/voice/toolSchemas'
import { parseYmd } from './period'

const horecaId = z.number().int().positive()
const limit = (fallback: number) => z.number().int().min(1).max(15).default(fallback)

const salesSummary = z
  .object({
    period: z.enum(['today', 'this_week', 'this_month', 'last_month', 'last_30_days', 'custom']),
    from: z.string().optional(),
    to: z.string().optional(),
    compare_previous: z.boolean().default(true),
    horeca_id: horecaId.optional(),
  })
  .strict()

const targetProgress = z.object({}).strict()

const followUpList = z.object({ limit: limit(8) }).strict()

const findCustomerArgs = z.object({ query: z.string().trim().min(1).max(100) }).strict()

const customerById = z.object({ horeca_id: horecaId }).strict()

const stockStatus = z
  .object({
    filter: z.enum(['summary', 'low', 'out']),
    category: z.string().trim().max(60).optional(),
  })
  .strict()

const reorderRecommendations = z
  .object({
    lead_time_days: z.number().int().min(1).max(60).default(14),
    limit: limit(10),
  })
  .strict()

const productMovement = z
  .object({
    kind: z.enum(['top', 'slow', 'dead']),
    limit: limit(10),
  })
  .strict()

const visitStats = z.object({ period: z.enum(['this_week', 'this_month', 'last_month']) }).strict()

export const TOOL_ARG_OBJECTS = {
  get_sales_summary: salesSummary,
  get_target_progress: targetProgress,
  get_follow_up_list: followUpList,
  find_customer: findCustomerArgs,
  get_customer_insights: customerById,
  get_suggested_order_for_customer: customerById,
  get_stock_status: stockStatus,
  get_reorder_recommendations: reorderRecommendations,
  get_product_movement: productMovement,
  get_visit_stats: visitStats,
} as const satisfies Record<VoiceToolName, z.AnyZodObject>

/** A custom period needs two real dates in order; any other period must not carry dates. */
function checkDates(value: z.infer<typeof salesSummary>, ctx: z.RefinementCtx): void {
  const issue = (path: 'from' | 'to', message: string): void =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message })

  if (value.period !== 'custom') {
    if (value.from !== undefined) issue('from', 'only allowed with period custom')
    if (value.to !== undefined) issue('to', 'only allowed with period custom')
    return
  }
  if (value.from === undefined) issue('from', 'required with period custom, as YYYY-MM-DD')
  if (value.to === undefined) issue('to', 'required with period custom, as YYYY-MM-DD')
  const from = value.from === undefined ? null : parseYmd(value.from)
  const to = value.to === undefined ? null : parseYmd(value.to)
  if (value.from !== undefined && !from) issue('from', 'must be a real date written YYYY-MM-DD')
  if (value.to !== undefined && !to) issue('to', 'must be a real date written YYYY-MM-DD')
  if (from && to && from.getTime() > to.getTime()) issue('to', 'must not be before from')
}

export const TOOL_ARG_SCHEMAS = {
  ...TOOL_ARG_OBJECTS,
  get_sales_summary: salesSummary.superRefine(checkDates),
} as const

export type ToolArgs<N extends VoiceToolName> = z.infer<(typeof TOOL_ARG_SCHEMAS)[N]>
