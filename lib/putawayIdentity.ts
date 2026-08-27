// Client-side entry point for "what should this putaway stop ask me to scan?".
//
// The rule lives in the pure shared module so the walk card and the Edge
// Function run the very same code — the prompt the operator reads is not a
// second implementation of what the server will accept, it IS that decision,
// evaluated early. Same split as lib/binCount.ts and lib/palletBreakdown.ts.
//
// This file re-exports it under `@/` and adds the things only a card needs:
// turning the verdict into the words on a label, and into the evidence keys
// sent to complete-putaway.

export {
  putawayIdentity,
  classifyPutawayScan,
  scanIsThisProduct,
  plateNeedsLabel,
} from '@/supabase/functions/_shared/putawayIdentity'

export type {
  PutawayExpect,
  PutawayIdentity,
  PutawayIdentityReason,
  PutawayIdentitySubject,
} from '@/supabase/functions/_shared/putawayIdentity'

import type { PutawayIdentity } from '@/supabase/functions/_shared/putawayIdentity'

/** What the operator is being asked to hold up to the gun, in the words that go
 *  on the ScanField. The CODE is quoted rather than the friendly name for the
 *  same reason the bin prompt quotes a bin code: the operator is matching a
 *  string against the big text on a sticker or a box, and that text is the code. */
export function identifyPrompt(
  identity: PutawayIdentity,
  args: { huCode: string | null; productBarcode: string | null; productName: string },
): string {
  if (identity.expect === 'plate') return `Scan the plate — expecting ${args.huCode}`
  if (identity.expect === 'product') {
    return args.productBarcode
      ? `Scan the product — expecting ${args.productBarcode}`
      : `Scan the product — ${args.productName}`
  }
  return 'Scan what you are carrying'
}

/** The placeholder: the exact string a correct scan produces, so an operator
 *  keying it by hand has something to copy. */
export function identifyPlaceholder(
  identity: PutawayIdentity,
  args: { huCode: string | null; productBarcode: string | null },
): string {
  if (identity.expect === 'plate') return args.huCode ?? ''
  if (identity.expect === 'product') return args.productBarcode ?? ''
  return ''
}

/** The one-line helper under the field. Says what the OTHER acceptable answer
 *  is, so an operator holding a printed plate label is never left thinking the
 *  barcode is the only key that fits. */
export function identifyHelper(identity: PutawayIdentity): string | undefined {
  if (identity.expect === 'plate' && identity.acceptsProduct) {
    return "The product's own barcode also works."
  }
  if (identity.expect === 'product' && identity.acceptsPlate) {
    return 'A plate label for this line also works, if one is on it.'
  }
  return undefined
}

/** The chip on the step strip. "Plate" and "Product" are different work; a
 *  single "Scan" chip would hide which one this stop wanted. */
export function identifyChipLabel(identity: PutawayIdentity): string {
  return identity.expect === 'product' ? 'Product' : 'Plate'
}
