// Advisory checks for a manually-chosen putaway bin.
//
// The engine's own hard filters run server-side at recommendation time; these
// are the client-side equivalents for a bin the operator picked THEMSELVES,
// which the server deliberately accepts (decide-putaway only requires an active
// bin inside the warehouse). The physical world wins: every finding here is a
// warning the operator can proceed past, never a block.
//
// Pure and IO-free — mirrors supabase/functions/_shared/wie/* so it is testable
// without mounting anything.

import type { InventoryLocation, LevelRole, Product, ZoneProfile } from '@/types'
import type { WarehouseBinBalance } from '@/services/supabase/inventoryService'

export type PutawayWarningCode = 'level_role_mismatch' | 'capacity' | 'zone_category' | 'weight' | 'not_storage'

export interface PutawayWarning {
  code: PutawayWarningCode
  message: string
}

/** Slots already consumed per location: Σ(on_hand × size_factor), the same
 *  arithmetic getBinFillSlots does for a single bin, over the whole warehouse in
 *  one pass so the picker can show fill for every bin without N queries. */
export function binFillFromBalances(
  balances: readonly WarehouseBinBalance[] | undefined,
): Map<number, number> {
  const fill = new Map<number, number>()
  for (const b of balances ?? []) {
    const slots = Number(b.onHand) * (Number(b.sizeFactor) || 1)
    fill.set(b.locationId, (fill.get(b.locationId) ?? 0) + slots)
  }
  return fill
}

/** The nearest ancestor-or-self carrying a zone profile. Zone semantics live on
 *  ZONE nodes (mig 00047) while stock goes into bins several levels below, so a
 *  bin inherits its zone's rules by walking up the parent chain. */
export function resolveZoneProfileId(
  bin: InventoryLocation | undefined,
  locationsById: ReadonlyMap<number, InventoryLocation>,
): number | undefined {
  let node = bin
  // Bounded by the tree depth; the guard also stops a cycle from hanging the UI.
  for (let hops = 0; node && hops < 32; hops++) {
    if (node.zoneProfileId != null) return node.zoneProfileId
    node = node.parentId != null ? locationsById.get(node.parentId) : undefined
  }
  return undefined
}

export interface EvaluateBinInput {
  bin: InventoryLocation
  zoneProfile?: ZoneProfile | null
  product?: Product | null
  /** Quantity being put away, in base units. */
  baseQty: number
  /** Slots already used in this bin (from binFillFromBalances). */
  usedSlots: number
  /** Per-base-unit weight from product_wms_attributes, when on file. */
  unitWeightKg?: number | null
  /** The SKU's `product_wms_attributes.allowed_level_roles` (mig 00072).
   *  Empty/null/undefined = unconstrained — every existing SKU's default. */
  allowedLevelRoles?: readonly LevelRole[] | null
}

/** True when `bin` is a rack level whose role the SKU does not allow. A bin
 *  with no `levelRole` (a legacy non-levelled location, or a RACK/WAREHOUSE
 *  parent) is never a mismatch — the hard rule only applies to real levels.
 *  A SKU with no (or empty) `allowedLevelRoles` is unconstrained, per the
 *  engine's NULL-means-any-role default. Pure so it is unit-testable and
 *  reusable for both the confirmed-selection warning and the browse-list badge. */
export function isLevelRoleMismatch(
  bin: Pick<InventoryLocation, 'levelRole'> | undefined,
  allowedLevelRoles: readonly LevelRole[] | null | undefined,
): boolean {
  if (!bin?.levelRole) return false
  if (!allowedLevelRoles || allowedLevelRoles.length === 0) return false
  return !allowedLevelRoles.includes(bin.levelRole)
}

/**
 * Advisory findings for putting `baseQty` of `product` into `bin`. Order is
 * stable (level role, capacity, zone, weight, kind) so the UI renders
 * deterministically.
 */
export function evaluateBinWarnings({
  bin,
  zoneProfile,
  product,
  baseQty,
  usedSlots,
  unitWeightKg,
  allowedLevelRoles,
}: EvaluateBinInput): PutawayWarning[] {
  const warnings: PutawayWarning[] = []

  // ── Level role (the HARD putaway rule; here as an operator-facing warning
  // because a MANUAL bin choice deliberately bypasses the engine's gate) ─────
  if (isLevelRoleMismatch(bin, allowedLevelRoles)) {
    const allowedLabel = (allowedLevelRoles ?? []).join(', ')
    warnings.push({
      code: 'level_role_mismatch',
      message:
        `${bin.code} is a ${bin.levelRole} level — this product is only allowed on ${allowedLabel} levels. ` +
        `Placing it here overrides the rule and is recorded.`,
    })
  }

  // ── Capacity ──────────────────────────────────────────────────────────────
  // A bin's capacity is counted in slots, and one base unit consumes
  // size_factor slots (mig 00039) — the quantity must be converted before it
  // can be compared to capacity_slots.
  const incomingSlots = baseQty * (product?.sizeFactor ?? 1)
  if (bin.capacitySlots != null && bin.capacitySlots > 0) {
    const after = usedSlots + incomingSlots
    if (after > bin.capacitySlots) {
      warnings.push({
        code: 'capacity',
        message:
          `Over capacity — ${bin.code} holds ${bin.capacitySlots} slots and this would ` +
          `take it to ${round(after)}.`,
      })
    }
  }

  // ── Zone category ─────────────────────────────────────────────────────────
  const allowed = zoneProfile?.allowedCategories
  if (allowed && allowed.length > 0 && product?.category) {
    const category = String(product.category)
    const permitted = allowed.some((c) => c.toLowerCase() === category.toLowerCase())
    if (!permitted) {
      warnings.push({
        code: 'zone_category',
        message: `${zoneProfile!.name} only takes ${allowed.join(', ')} — this is ${category}.`,
      })
    }
  }

  // ── Weight ────────────────────────────────────────────────────────────────
  // Only the DEFINITE overflow is reported. The bin's current load in kg comes
  // from wie_putaway_candidates, which is service_role-only, so the client
  // cannot see it — a drop that fits on its own but tips an already-loaded bin
  // over is invisible here and is caught by the engine at recommendation time.
  if (bin.weightCapacityKg != null && unitWeightKg != null && unitWeightKg > 0) {
    const incomingKg = baseQty * unitWeightKg
    if (incomingKg > bin.weightCapacityKg) {
      warnings.push({
        code: 'weight',
        message:
          `Too heavy — ${round(incomingKg)} kg into a bin rated for ${bin.weightCapacityKg} kg.`,
      })
    }
  }

  // ── Kind ──────────────────────────────────────────────────────────────────
  // Staging/dock/returns nodes are `label` objects in a layout, not storage.
  // Putting stock there strands it outside the engine's world view.
  if (bin.kind === 'STAGING' || bin.kind === 'WAREHOUSE') {
    warnings.push({
      code: 'not_storage',
      message: `${bin.code} is a staging area, not a storage bin — stock left here stays unslotted.`,
    })
  }

  return warnings
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
