// get_promotions: what is on promotion right now (NX-0014).
//
// "Active" is the Shop's own rule, pricing.ts isPromotionActive: switched on, and
// today inside its start and end dates. (That rule compares UTC dates, not
// Sydney; it is reused as-is so Nex and the Shop agree, and fixing it belongs to
// both together.) Each promotion is described in words Nex can say: the
// discount, what it covers and who it is for. Offered only where the promotions
// module is on (toolsForRole).

import { isPromotionActive } from '@/pricing'
import type { Promotion } from '@/types'
import type { VoiceToolContext } from '../context'
import type { ToolArgs } from '../toolArgs'
import { dayOf, ok } from './common'
import type { ToolOutcome } from './common'

const MAX_PROMOTIONS = 10

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

function discountOf(promo: Promotion): string {
  switch (promo.type) {
    case 'percentage':
      return `${promo.percentOff ?? 0}% off`
    case 'clearance':
      return `${promo.clearancePercent ?? 0}% off (clearance)`
    case 'fixed_price':
      return `${money(promo.fixedPrice ?? 0)} each`
    case 'bogo': {
      const c = promo.bogoConfig
      return c ? `buy ${c.buyQuantity}, get ${c.getQuantity} free` : 'buy one, get one'
    }
    case 'bundle':
      return promo.bundleConfig ? `bundle for ${money(promo.bundleConfig.bundlePrice)}` : 'bundle price'
    default:
      return 'special price'
  }
}

function coversOf(promo: Promotion, ctx: VoiceToolContext): string {
  const scope = promo.scope
  if (scope.kind === 'storewide') return 'storewide'
  if (scope.kind === 'categories') return scope.categories.join(', ')
  const names = scope.productIds.map((id) => ctx.products.find((p) => p.id === id)?.name).filter((n): n is string => Boolean(n))
  return names.length > 0 ? names.join(', ') : `${scope.productIds.length} products`
}

function forWhomOf(promo: Promotion, ctx: VoiceToolContext): string {
  const t = promo.targeting
  switch (t.kind) {
    case 'all':
      return 'all customers'
    case 'tier':
      return `${t.tiers.join(' and ')} tier customers`
    case 'horecas': {
      const names = t.hoReCaIds.map((id) => ctx.hoReCas.find((c) => c.id === id)?.name).filter((n): n is string => Boolean(n))
      return names.length > 0 ? names.join(', ') : `${t.hoReCaIds.length} customers`
    }
    case 'rep':
      return "one rep's customers"
    default:
      return 'selected customers'
  }
}

export function getPromotions(_args: ToolArgs<'get_promotions'>, ctx: VoiceToolContext): ToolOutcome {
  const live = ctx.promotions.filter((p) => isPromotionActive(p, ctx.now))
  const promotions = [...live]
    .sort((a, b) => a.priority - b.priority) // stable: equal priority keeps the order the app holds
    .slice(0, MAX_PROMOTIONS)
    .map((p) => ({
      name: p.name,
      kind: p.type,
      discount: discountOf(p),
      covers: coversOf(p, ctx),
      forWhom: forWhomOf(p, ctx),
      endsOn: p.endDate ?? null,
    }))
  return ok(`promotions switched on and inside their dates on ${dayOf(ctx.now.toISOString())}, the same rule the Shop uses`, {
    total: live.length,
    promotions,
  })
}
