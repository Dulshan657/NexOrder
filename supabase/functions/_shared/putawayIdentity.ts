// What identifies the goods on a putaway stop — the one definition, both runtimes.
//
// The walk asks the operator to prove they are carrying the right thing before
// it asks where they put it. For a long time it asked exactly one question —
// "scan the plate" — whenever the task named a handling unit. That is the wrong
// question most of the time, and it was unanswerable some of the time:
//
//   * A plate is minted for EVERY received line (receive-stock's createPlates
//     auto-mints one for any line that declares none), but a sticker is only
//     printed if somebody explicitly renders one. So a task can name a plate
//     that has no physical label anywhere — HU-000509 on the demo, 12 cartons of
//     a product whose own barcode is printed on the box.
//   * The operating rule on the floor is the other way round: the PRODUCT
//     barcode identifies the goods. A plate label is needed for a pallet (where
//     the barcode on a carton cannot tell two identical pallets apart), for
//     goods that carry no barcode, and for a barcode that arrived damaged.
//
// So this module answers "what should this stop ask for?" from the facts, and
// the card asks that. It is pure and dependency-light for the usual reason: the
// browser's prompt and the server's expectations cannot drift if there is only
// one of them.
//
// Note the deliberate split between what is ASKED FOR and what is ACCEPTED. The
// prompt names one thing, because a prompt naming two things is a prompt that
// teaches nobody what to do. The field accepts either the plate code or the
// product code and routes it to the right evidence key — an operator who
// happens to hold a printed plate label should never be refused for scanning
// the stronger evidence.

import { codeMatchesProduct, normalizeScan } from './scanNormalize.ts'

/** What the identify step names in its prompt. `'none'` means there is nothing
 *  the operator can scan, and the step is skipped. */
export type PutawayExpect = 'plate' | 'product' | 'none'

/** Why the answer came out the way it did. Carried so the card can phrase
 *  itself, and so a test pins the branch rather than only its output. */
export type PutawayIdentityReason =
  | 'no_plate'
  | 'label_printed'
  | 'pallet_unlabelled'
  | 'product_barcode'
  | 'nothing_scannable'

/** The facts the rule reads. Deliberately not the whole task row — everything
 *  here is available on both a `PendingPutawayRow` and an Edge Function's own
 *  join, and nothing else is needed. */
export interface PutawayIdentitySubject {
  /** The plate this task names. NULL for legacy stock and the CSV opening-stock
   *  path, neither of which has a container at all. */
  huCode?: string | null
  huType?: 'pallet' | 'carton' | null
  /** Has a sticker ever been rendered for that plate? */
  huLabelPrinted?: boolean
  /** The product's own barcode, when the catalogue carries one. */
  productBarcode?: string | null
}

export interface PutawayIdentity {
  expect: PutawayExpect
  reason: PutawayIdentityReason
  /** This plate genuinely ought to carry a sticker under the operating rule —
   *  it is a pallet, or nothing else can identify these goods. Drives whether
   *  the card offers printing prominently or quietly. */
  needsLabel: boolean
  /** A label could be rendered right now: there is a plate and it has none.
   *  True in the quiet case too — a damaged barcode is a real reason to want a
   *  plate label on a product that ordinarily would not need one. */
  canPrintLabel: boolean
  acceptsPlate: boolean
  acceptsProduct: boolean
}

/**
 * What should this stop ask the operator to scan?
 *
 * The branches, in order, and why each sits where it does:
 *
 *   1. No plate at all — nothing to ask about a container, and this is the
 *      pre-existing behaviour for legacy/CSV lines, preserved exactly. We do
 *      NOT start demanding a product scan here: those lines have never had an
 *      identify step and adding one turns a working path into a slower one for
 *      no new evidence the operator could have got wrong.
 *   2. The label is printed — scan it. The sticker exists, and a plate is the
 *      strongest evidence available because it names this exact unit load and
 *      not merely the SKU.
 *   3. An unlabelled PALLET — still ask for the plate, and offer to print it.
 *      This is the case the operating rule says wants a label: a carton barcode
 *      on a pallet identifies the SKU and cannot distinguish two pallets of it.
 *   4. The product carries a barcode — ask for that. The ordinary carton case,
 *      and the one that was being refused.
 *   5. Nothing scannable — no printed label and no barcode. Offer to print, and
 *      let the stop proceed unverified rather than strand the goods on the dock.
 */
export function putawayIdentity(subject: PutawayIdentitySubject): PutawayIdentity {
  const huCode = subject.huCode ?? null
  const hasBarcode = Boolean((subject.productBarcode ?? '').trim())

  if (!huCode) {
    return {
      expect: 'none',
      reason: 'no_plate',
      needsLabel: false,
      canPrintLabel: false,
      acceptsPlate: false,
      acceptsProduct: false,
    }
  }

  if (subject.huLabelPrinted) {
    return {
      expect: 'plate',
      reason: 'label_printed',
      needsLabel: false,
      canPrintLabel: false,
      acceptsPlate: true,
      acceptsProduct: hasBarcode,
    }
  }

  if (subject.huType === 'pallet') {
    return {
      expect: 'plate',
      reason: 'pallet_unlabelled',
      needsLabel: true,
      canPrintLabel: true,
      acceptsPlate: true,
      acceptsProduct: hasBarcode,
    }
  }

  if (hasBarcode) {
    return {
      expect: 'product',
      reason: 'product_barcode',
      needsLabel: false,
      canPrintLabel: true,
      acceptsPlate: true,
      acceptsProduct: true,
    }
  }

  return {
    expect: 'none',
    reason: 'nothing_scannable',
    needsLabel: true,
    canPrintLabel: true,
    acceptsPlate: true,
    acceptsProduct: false,
  }
}

/**
 * Which evidence key does this raw scan belong in?
 *
 * A plate code and a product barcode arrive through the same field as the same
 * bare string — that is the whole point of the unprefixed payload (see
 * lib/scan/resolveScan.ts). The task already knows its own plate code, so this
 * needs no index and no lookup: it is the plate if it IS the plate, and a
 * product claim otherwise.
 *
 * Returning `'product'` for an unrelated string is deliberate and safe:
 * checkPutawayScan then refuses it as WRONG_PRODUCT, naming the SKU the
 * operator should be holding. Routing it to `handlingUnitCode` instead would
 * produce "that is plate 4796009868869", which calls a barcode a plate.
 */
export function classifyPutawayScan(
  raw: string,
  subject: Pick<PutawayIdentitySubject, 'huCode'>,
): 'plate' | 'product' {
  const scanned = normalizeScan(raw)
  const plate = normalizeScan(subject.huCode ?? '')
  return scanned && plate && scanned === plate ? 'plate' : 'product'
}

/** Does this scan look like the product's own barcode or SKU? Used only for
 *  phrasing — the refusal itself is checkPutawayScan's job. */
export function scanIsThisProduct(
  raw: string,
  product: { sku: string; barcode?: string | null },
): boolean {
  const scanned = normalizeScan(raw)
  return Boolean(scanned) && codeMatchesProduct(scanned, product)
}

/**
 * Does this plate want a sticker printed for it?
 *
 * The receiving-desk half of the same rule `putawayIdentity` applies at the
 * rack, and it lives here so there is one statement of "when does a plate need
 * a label" rather than two that can drift:
 *
 *   * a PALLET always does — a carton barcode identifies the SKU and cannot
 *     tell two pallets of it apart, which is exactly what putaway must know;
 *   * anything else does only when the goods cannot identify themselves.
 *
 * `productBarcodes` is every product on the plate. A mixed plate is a pallet by
 * construction (a carton holds one product), so in practice this is one entry —
 * but taking the list means a mixed plate whose members are all barcoded still
 * answers on the pallet branch, which is the branch that matters for it.
 */
export function plateNeedsLabel(plate: {
  huType?: 'pallet' | 'carton' | null
  labelPrinted?: boolean
  productBarcodes: ReadonlyArray<string | null | undefined>
}): boolean {
  if (plate.labelPrinted) return false
  if (plate.huType === 'pallet') return true
  return plate.productBarcodes.some((b) => !(b ?? '').trim())
}
