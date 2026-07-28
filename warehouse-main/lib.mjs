// Shared plumbing for the MAIN warehouse seed/reset.
//
// Two clients, on purpose:
//  · `supa`  — service role. Reads, and the handful of writes that have no Edge
//              Function (zone_profiles, wie_rules, wie_product_velocity).
//  · `asAdmin()` — a real Admin session. Every privileged mutation goes through
//              the shipped Edge Functions so this seed exercises the same
//              validation, audit and putaway code path the app does.

// Dev-only. createDevClient() resolves the target (--env=dev, baked into the
// npm script), asserts the credentials belong to it, and asks the database
// itself whether it is dev — all before a single row is touched.

import { createClient } from '@supabase/supabase-js'

import { createDevClient } from '../scripts/lib/devClient.mjs'

const { supa: serviceClient, env: ENV, target: TARGET } = await createDevClient()

const SUPABASE_URL = TARGET.config.supabaseUrl
const ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY

if (!ANON_KEY) {
  console.error(`Missing VITE_SUPABASE_ANON_KEY (set it in ${TARGET.config.envFile}).`)
  process.exit(1)
}

export const supa = serviceClient

export const ADMIN_EMAIL = ENV.WAREHOUSE_SEED_ADMIN_EMAIL || 'alice@nexorder.com.au'
export const ADMIN_PASSWORD = ENV.WAREHOUSE_SEED_ADMIN_PASSWORD || 'Password123!'

let adminClient = null

/** Sign in once as an Admin; the session is reused for every function call. */
export async function asAdmin() {
  if (adminClient) return adminClient
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  if (error) {
    throw new Error(
      `Admin sign-in failed for ${ADMIN_EMAIL}: ${error.message}. ` +
      'Override with WAREHOUSE_SEED_ADMIN_EMAIL / WAREHOUSE_SEED_ADMIN_PASSWORD.',
    )
  }
  adminClient = client
  return client
}

/**
 * Invoke an Edge Function as the Admin and unwrap the response.
 * Edge Functions return `{ok:false, ...}` at HTTP 200 for domain rejections, so
 * a transport-level success is not enough — check the envelope too.
 */
export async function invokeAdmin(name, body) {
  const client = await asAdmin()
  const { data, error } = await client.functions.invoke(name, { body })
  if (error) {
    // supabase-js hides the response body on non-2xx; dig it out so failures are readable.
    let detail = error.message
    try { detail = JSON.stringify(await error.context?.json?.()) ?? detail } catch { /* keep message */ }
    throw new Error(`${name} failed: ${detail}`)
  }
  if (data && data.ok === false) {
    throw new Error(`${name} rejected: ${JSON.stringify(data)}`)
  }
  return data
}

// ── Constants ────────────────────────────────────────────────────────────────

export const WH_CODE = 'MAIN'

/** reset.mjs finds the layout this seed published by name, so it must be stable. */
export const LAYOUT_NAME = 'Main DC'

/** Zone profiles reused as-is (allowed_categories is NULL on all four). */
export const REUSED_ZONE_TYPES = {
  fast: 'fast_moving',
  slow: 'slow_moving',
  bulk: 'bulk',
  overflow: 'overflow',
}

/** The one profile we add. Kept separate from the shared 'Cold Storage' profile,
 *  which WIE-DEMO's chilled zone already points at. */
export const COLD_ZONE = {
  name: 'Main Cold Storage',
  zone_type: 'cold',
  priority_weight: 0.7,
  allowed_categories: ['Plant-Based'],
}

/** Storage forms sized in cartons, matching `on_hand`'s base unit.
 *  levels x positions_per_level MUST equal default_capacity_slots or the Storage
 *  Forms editor (lib/storageFormCapacity.ts deriveCapacitySlots) disagrees. */
export const STORAGE_FORMS = [
  {
    key: 'palletBay',
    code: 'MAIN_PALLET_BAY',
    name: 'Pallet Rack Bay',
    levels: 5,
    positions_per_level: 24,
    default_capacity_slots: 120,
    slot_unit: 'carton',
    weight_capacity_kg: 1200,
    color: '#10b981',
    sort_order: 10,
  },
  {
    key: 'shelfBay',
    code: 'MAIN_SHELF_BAY',
    name: 'Shelf Bay',
    levels: 5,
    positions_per_level: 12,
    default_capacity_slots: 60,
    slot_unit: 'carton',
    weight_capacity_kg: 400,
    color: '#6366f1',
    sort_order: 11,
  },
  {
    key: 'coldBay',
    code: 'MAIN_COLD_BAY',
    name: 'Cold Rack Bay',
    levels: 3,
    positions_per_level: 30,
    default_capacity_slots: 90,
    slot_unit: 'carton',
    weight_capacity_kg: 900,
    color: '#0ea5e9',
    sort_order: 12,
  },
  {
    key: 'bulkFloor',
    code: 'MAIN_BULK_FLOOR',
    name: 'Bulk Floor Block',
    // Flat capacity, deliberately finite: a NULL capacity fails the over-capacity
    // filter open (scoring.ts filterCandidates), so the engine would dump
    // everything on the floor.
    levels: null,
    positions_per_level: null,
    default_capacity_slots: 1000,
    slot_unit: 'carton',
    weight_capacity_kg: null,
    color: '#f59e0b',
    sort_order: 13,
  },
]

/** Warehouse-scoped putaway rules. `wie_rules.warehouse_id` keeps these off WIE-DEMO. */
export const RULES = [
  {
    name: 'Dedicated slotting',
    rule_type: 'putaway',
    enforcement: 'soft',
    priority: 50,
    definition: {
      conditionLogic: 'and',
      conditions: [
        { subject: 'bin', attr: 'usedSlots', op: 'gt', value: 0 },
        { subject: 'bin', attr: 'hasSameProduct', op: 'eq', value: false },
      ],
      action: { effect: 'penalty', delta: 0.4 },
    },
  },
  {
    name: 'Plant-Based must be chilled',
    rule_type: 'putaway',
    enforcement: 'hard',
    priority: 100,
    definition: {
      conditionLogic: 'and',
      conditions: [{ subject: 'product', attr: 'category', op: 'eq', value: 'Plant-Based' }],
      action: { effect: 'require', target: { scope: 'zone', attr: 'zoneType', op: 'eq', value: 'cold' } },
    },
  },
]

/** Look up the MAIN warehouse root, failing loudly rather than silently seeding elsewhere. */
export async function getWarehouse() {
  const { data, error } = await supa.from('locations')
    .select('id, code, name, materialized_path, location_type, active_layout_id')
    .eq('code', WH_CODE).eq('kind', 'WAREHOUSE').single()
  if (error || !data) throw new Error(`Could not find the ${WH_CODE} warehouse: ${error?.message}`)
  return data
}

export const fmt = (n) => Number(n).toLocaleString('en-AU')
