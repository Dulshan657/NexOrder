// The one door every voice tool call goes through.
//
//   runVoiceTool(name, rawArgs, ctx) -> { ok, basis, asOf, data } | { ok: false, error }
//
// In order: is it a tool at all; may THIS caller use it; are the arguments valid;
// run it; add `asOf`; keep it small enough to speak from. It never throws and
// never changes the context: the model gets an error string it can say aloud,
// never a stack trace.
//
// PERMISSION has one source of truth, toolsForRole in the shared voice contract
// (the same function the Edge Function uses to decide which tools to OFFER). There
// is no forbidden-tools list here to drift from it. Because the check comes before
// argument validation, a bad call to a forbidden tool learns nothing about what a
// good one looks like.
//
// The model chooses the arguments but never the scope. A rep's figures are their
// own because each tool filters on ctx.user.numericId, and no argument can name a
// different rep.

import { describeValidationIssues } from '@/lib/functionError'
import { VOICE_TOOL_NAMES, toolsForRole } from '@/supabase/functions/_shared/voice/toolSchemas'
import type { VoiceToolName } from '@/supabase/functions/_shared/voice/toolSchemas'
import type { z } from 'zod'
import type { ToolOutcome, VoiceToolContext, VoiceToolResult } from './context'
import { fitToBudget } from './resultBudget'
import { TOOL_ARG_SCHEMAS } from './toolArgs'
import { findCustomerTool } from './tools/findCustomerTool'
import { getCustomerInsights } from './tools/getCustomerInsights'
import { getFollowUpList } from './tools/getFollowUpList'
import { getProductMovement } from './tools/getProductMovement'
import { getReorderRecommendations } from './tools/getReorderRecommendations'
import { getSalesSummary } from './tools/getSalesSummary'
import { getStockStatus } from './tools/getStockStatus'
import { getSuggestedOrderForCustomer } from './tools/getSuggestedOrderForCustomer'
import { getTargetProgress } from './tools/getTargetProgress'
import { getVisitStats } from './tools/getVisitStats'

export type { VoiceToolContext, VoiceToolResult } from './context'

export interface RunVoiceToolOptions {
  /** Told about a tool that crashed (a bug or bad data, not a refusal), so it can be reported. */
  onError?: (toolName: string, error: unknown) => void
}

const NOT_AVAILABLE = 'Not available for your role'
const UNKNOWN_TOOL = 'Unknown tool'
const LOOKUP_FAILED = 'That lookup failed'
const MAX_ERROR_CHARS = 300

type Runner = (rawArgs: unknown, ctx: VoiceToolContext) => ToolOutcome

/** Parse the arguments with `schema`, then run `tool`; invalid arguments become an error outcome. */
function bind<S extends z.ZodTypeAny>(schema: S, tool: (args: z.infer<S>, ctx: VoiceToolContext) => ToolOutcome): Runner {
  return (rawArgs, ctx) => {
    const parsed = schema.safeParse(rawArgs ?? {})
    if (parsed.success) return tool(parsed.data, ctx)
    const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    const detail = describeValidationIssues({ issues })
    return { ok: false, error: `Invalid arguments${detail ? `: ${detail}` : ''}`.slice(0, MAX_ERROR_CHARS) }
  }
}

const RUNNERS: Readonly<Record<VoiceToolName, Runner>> = {
  get_sales_summary: bind(TOOL_ARG_SCHEMAS.get_sales_summary, getSalesSummary),
  get_target_progress: bind(TOOL_ARG_SCHEMAS.get_target_progress, getTargetProgress),
  get_follow_up_list: bind(TOOL_ARG_SCHEMAS.get_follow_up_list, getFollowUpList),
  find_customer: bind(TOOL_ARG_SCHEMAS.find_customer, findCustomerTool),
  get_customer_insights: bind(TOOL_ARG_SCHEMAS.get_customer_insights, getCustomerInsights),
  get_suggested_order_for_customer: bind(TOOL_ARG_SCHEMAS.get_suggested_order_for_customer, getSuggestedOrderForCustomer),
  get_stock_status: bind(TOOL_ARG_SCHEMAS.get_stock_status, getStockStatus),
  get_reorder_recommendations: bind(TOOL_ARG_SCHEMAS.get_reorder_recommendations, getReorderRecommendations),
  get_product_movement: bind(TOOL_ARG_SCHEMAS.get_product_movement, getProductMovement),
  get_visit_stats: bind(TOOL_ARG_SCHEMAS.get_visit_stats, getVisitStats),
}

function isToolName(name: string): name is VoiceToolName {
  return (VOICE_TOOL_NAMES as readonly string[]).includes(name)
}

function isPermitted(name: VoiceToolName, ctx: VoiceToolContext): boolean {
  return toolsForRole(ctx.user.role, ctx.modules).some((tool) => tool.name === name)
}

function report(options: RunVoiceToolOptions, name: string, error: unknown): void {
  try {
    options.onError?.(name, error)
  } catch {
    // The reporter is best-effort. A reporter that throws must not turn a
    // spoken answer into a crash, and there is nobody left to tell.
  }
}

export function runVoiceTool(
  name: string,
  rawArgs: unknown,
  ctx: VoiceToolContext,
  options: RunVoiceToolOptions = {},
): VoiceToolResult {
  if (!isToolName(name)) return { ok: false, error: UNKNOWN_TOOL }
  try {
    if (!isPermitted(name, ctx)) return { ok: false, error: NOT_AVAILABLE }
    const outcome = RUNNERS[name](rawArgs, ctx)
    if (outcome.ok === false) return outcome
    return fitToBudget({ ok: true, basis: outcome.basis, asOf: ctx.now.toISOString(), data: outcome.data })
  } catch (error: unknown) {
    report(options, name, error)
    return { ok: false, error: LOOKUP_FAILED }
  }
}
