// find_customer: turn a spoken name into customer ids the other tools take.

import { findCustomer } from '../findCustomer'
import type { VoiceToolContext } from '../context'
import { allowedCustomerIds, isRep } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { ok } from './common'
import type { ToolOutcome } from './common'

export function findCustomerTool(args: ToolArgs<'find_customer'>, ctx: VoiceToolContext): ToolOutcome {
  const match = findCustomer(args.query, ctx.hoReCas, allowedCustomerIds(ctx))
  const reach = isRep(ctx) ? 'the customers you have sold to' : 'all customers'
  return ok(`closest customer names to what was said, among ${reach}`, match)
}
