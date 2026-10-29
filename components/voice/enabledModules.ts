// The module slugs this build ships, for VoiceToolContext.modules.
//
// Built from the FOLDED MODULE_* constants (lib/modules.ts), so each entry is a
// literal `true`/`false` at build time and the list is fixed per target. It is a
// value derived from the gates, not a gate itself: nothing decides whether to
// ship code by reading it. toolsForRole reads it to decide which tools a role
// may call, the same way the Edge Function does with the server's module set.

import {
  MODULE_FIELD_OPS,
  MODULE_INVENTORY_DISPATCH,
  MODULE_INVOICING,
  MODULE_PO_INBOX,
  MODULE_PROMOTIONS,
  MODULE_SALES_ORDERS,
  MODULE_SHOP,
  MODULE_VOICE_ASSISTANT,
} from '@/lib/modules'

const FLAGS: ReadonlyArray<readonly [string, boolean]> = [
  ['sales_orders', MODULE_SALES_ORDERS],
  ['shop', MODULE_SHOP],
  ['po_inbox', MODULE_PO_INBOX],
  ['promotions', MODULE_PROMOTIONS],
  ['invoicing', MODULE_INVOICING],
  ['field_ops', MODULE_FIELD_OPS],
  ['inventory_dispatch', MODULE_INVENTORY_DISPATCH],
  ['voice_assistant', MODULE_VOICE_ASSISTANT],
]

const ENABLED: readonly string[] = Object.freeze(FLAGS.filter(([, on]) => on).map(([slug]) => slug))

/** The enabled slugs, as one frozen array (the same object every call). */
export function enabledModules(): readonly string[] {
  return ENABLED
}
