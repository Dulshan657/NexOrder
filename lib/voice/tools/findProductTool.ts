// find_product: turn a spoken product name into product ids the other tools take.

import { findProduct } from '../findProduct'
import type { VoiceToolContext } from '../context'
import { activeProducts } from '../scope'
import type { ToolArgs } from '../toolArgs'
import { ok } from './common'
import type { ToolOutcome } from './common'

export function findProductTool(args: ToolArgs<'find_product'>, ctx: VoiceToolContext): ToolOutcome {
  const match = findProduct(args.query, activeProducts(ctx))
  return ok('closest product names to what was said, among active products; sizes said aloud ("210 mill") are matched to the catalogue spelling ("210ml")', match)
}
