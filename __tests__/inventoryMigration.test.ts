import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Text-parse smoke tests for the Inventory & Dispatch migrations (00027-00030).
//
// Same rationale as poInboxMigrations.test.ts: the local toolchain has no live
// PG to run migrations against, so these guard the structural invariants the
// rest of the system depends on (tables, the balance CHECKs that prevent
// oversell/over-allocate, service_role-only RPC EXECUTE, RLS, realtime).
//
// The runtime behavior of the inv_* RPCs is verified separately against the
// live database during deployment.

const ROOT = resolve(__dirname, '..');
const read = (relPath: string) => readFileSync(resolve(ROOT, relPath), 'utf8');

const INV_SQL = read('supabase/migrations/00027_inventory_and_dispatch.sql');
const FIX_LOCK_SQL = read('supabase/migrations/00028_fix_inv_fifo_lock.sql');
const FIX_UPSERT_SQL = read('supabase/migrations/00029_fix_inv_apply_leg_upsert.sql');
const PARTIAL_SQL = read('supabase/migrations/00030_inv_reserve_allow_partial.sql');
const DOC_BUCKET_SQL = read('supabase/migrations/00031_order_documents_bucket.sql');
const WAREHOUSE_SQL = read('supabase/migrations/00032_warehouse_read_access.sql');
const PICK_TOLERATE_SQL = read('supabase/migrations/00033_inv_pick_tolerate_unreserved.sql');
const PICK_ZONE_SQL = read('supabase/migrations/00083_reserve_order_pick_zone.sql');
const RACK_HU_SQL = read('supabase/migrations/00085_convert_rack_levels_handling_units.sql');

const containsCreateTable = (sql: string, table: string): boolean =>
  new RegExp(`CREATE\\s+TABLE\\s+public\\.${table}\\b`, 'i').test(sql);

describe('00027_inventory_and_dispatch migration', () => {
  describe('tables', () => {
    it.each([
      'locations',
      'batches',
      'inventory_balances',
      'inventory_movements',
      'order_documents',
      'pick_progress',
    ])('creates %s', (table) => {
      expect(containsCreateTable(INV_SQL, table)).toBe(true);
    });
  });

  describe('Warehouse role', () => {
    it('widens profiles.role CHECK to include Warehouse', () => {
      expect(/profiles_role_check[\s\S]*?'Warehouse'/i.test(INV_SQL)).toBe(true);
    });
  });

  describe('products replenishment columns', () => {
    it.each([
      'reorder_point',
      'safety_stock',
      'lead_time_days',
      'preferred_supplier_id',
      'is_active',
      'barcode',
    ])('adds products.%s', (col) => {
      expect(new RegExp(`ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${col}\\b`, 'i').test(INV_SQL)).toBe(true);
    });
  });

  describe('inventory_balances integrity', () => {
    it('computes available as a generated stored column', () => {
      expect(/available\s+NUMERIC[\s\S]*?GENERATED\s+ALWAYS\s+AS\s*\(\s*on_hand\s*-\s*allocated\s*\)\s+STORED/i.test(INV_SQL)).toBe(true);
    });

    it('forbids negative on_hand / allocated', () => {
      expect(/CHECK\s*\(\s*on_hand\s*>=\s*0\s+AND\s+allocated\s*>=\s*0\s*\)/i.test(INV_SQL)).toBe(true);
    });

    it('caps allocated at on_hand (no over-reservation)', () => {
      expect(/CHECK\s*\(\s*allocated\s*<=\s*on_hand\s*\)/i.test(INV_SQL)).toBe(true);
    });

    it('has the COALESCE(batch_id,0) unique slot index', () => {
      expect(/CREATE\s+UNIQUE\s+INDEX\s+uq_inventory_balances_slot\s+ON\s+public\.inventory_balances\s*\(\s*product_id\s*,\s*location_id\s*,\s*COALESCE\(\s*batch_id\s*,\s*0\s*\)\s*\)/i.test(INV_SQL)).toBe(true);
    });
  });

  describe('inventory_movements ledger', () => {
    it('restricts movement_type to the eight known types', () => {
      for (const t of ['receipt', 'allocate', 'deallocate', 'pick', 'adjustment', 'stocktake_variance', 'transfer_out', 'transfer_in']) {
        expect(new RegExp(`'${t}'`).test(INV_SQL)).toBe(true);
      }
    });
  });

  describe('seed + backfill', () => {
    it('seeds the single MAIN warehouse', () => {
      expect(/'WAREHOUSE'\s*,\s*'MAIN'/i.test(INV_SQL)).toBe(true);
    });

    it('backfills inventory_balances from products.inventory', () => {
      expect(/INSERT\s+INTO\s+public\.inventory_balances[\s\S]*?FROM\s+public\.products\s+p\s*,\s*wh/i.test(INV_SQL)).toBe(true);
    });
  });

  describe('RPCs', () => {
    it.each([
      'inv_default_location',
      'inv_recompute_product_cache',
      'inv_apply_leg',
      'inv_reserve_order',
      'inv_release_reservation',
      'inv_pick_order_line',
      'inv_receive_stock',
    ])('defines %s', (fn) => {
      expect(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\b`, 'i').test(INV_SQL)).toBe(true);
    });

    it('declares the state-changing RPCs SECURITY DEFINER', () => {
      // Every inv_apply/reserve/pick/receive function must be SECURITY DEFINER.
      const defts = INV_SQL.match(/SECURITY\s+DEFINER/gi) ?? [];
      expect(defts.length).toBeGreaterThanOrEqual(5);
    });

    it('locks EXECUTE on the mutating RPCs to service_role only', () => {
      for (const fn of ['inv_reserve_order', 'inv_release_reservation', 'inv_pick_order_line', 'inv_receive_stock']) {
        expect(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\b[\\s\\S]*?FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i').test(INV_SQL)).toBe(true);
        expect(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\b[\\s\\S]*?TO\\s+service_role`, 'i').test(INV_SQL)).toBe(true);
      }
    });
  });

  describe('RLS', () => {
    it.each([
      'locations',
      'batches',
      'inventory_balances',
      'inventory_movements',
      'order_documents',
      'pick_progress',
    ])('enables RLS on %s', (table) => {
      expect(new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(INV_SQL)).toBe(true);
    });

    it('grants only SELECT to authenticated (no direct writes)', () => {
      expect(/GRANT\s+SELECT\s+ON[\s\S]*?inventory_balances[\s\S]*?TO\s+authenticated/i.test(INV_SQL)).toBe(true);
      expect(/GRANT\s+(SELECT\s*,\s*)?INSERT[\s\S]*?(inventory_balances|inventory_movements|pick_progress)[\s\S]*?TO\s+authenticated/i.test(INV_SQL)).toBe(false);
    });

    it('creates NO write policies on the inventory tables (service_role only)', () => {
      for (const t of ['inventory_balances', 'inventory_movements', 'pick_progress', 'order_documents', 'batches', 'locations']) {
        const writeRegex = new RegExp(`CREATE\\s+POLICY\\s+"[^"]*"\\s+ON\\s+public\\.${t}\\s+FOR\\s+(INSERT|UPDATE|DELETE)`, 'i');
        expect(writeRegex.test(INV_SQL)).toBe(false);
      }
    });

    it('excludes customers from inventory_balances SELECT', () => {
      const policy = INV_SQL.match(/CREATE\s+POLICY\s+"inventory_balances_select_staff"[\s\S]*?;/i)?.[0] ?? '';
      expect(policy).not.toMatch(/Restaurant\/Hotel Customer/i);
    });
  });

  describe('realtime', () => {
    it.each(['inventory_balances', 'pick_progress', 'order_documents'])(
      'adds %s to supabase_realtime',
      (table) => {
        expect(new RegExp(`ALTER\\s+PUBLICATION\\s+supabase_realtime\\s+ADD\\s+TABLE\\s+public\\.${table}`, 'i').test(INV_SQL)).toBe(true);
      },
    );
  });
});

describe('00028 FIFO lock fix', () => {
  it('scopes the row lock to the balances alias (FOR UPDATE OF b)', () => {
    expect(/FOR\s+UPDATE\s+OF\s+b/i.test(FIX_LOCK_SQL)).toBe(true);
    expect(/FOR\s+UPDATE\s+OF\s+b/i.test(INV_SQL)).toBe(true);
  });
});

describe('00029 apply-leg upsert fix', () => {
  it('UPDATE-first then INSERT-on-missing (avoids bare-delta CHECK violation)', () => {
    expect(/UPDATE\s+public\.inventory_balances[\s\S]*?IF\s+NOT\s+FOUND\s+THEN[\s\S]*?INSERT\s+INTO\s+public\.inventory_balances/i.test(FIX_UPSERT_SQL)).toBe(true);
  });
});

describe('00030 partial reservation', () => {
  it('drops the old 3-arg signature before redefining', () => {
    expect(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.inv_reserve_order\(TEXT,\s*JSONB,\s*UUID\)/i.test(PARTIAL_SQL)).toBe(true);
  });

  it('adds p_allow_partial and only raises INSUFFICIENT_STOCK when not partial', () => {
    expect(/p_allow_partial\s+BOOLEAN\s+DEFAULT\s+false/i.test(PARTIAL_SQL)).toBe(true);
    expect(/v_remaining\s*>\s*0\s+AND\s+NOT\s+p_allow_partial/i.test(PARTIAL_SQL)).toBe(true);
  });

  it('keeps EXECUTE locked to service_role', () => {
    expect(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.inv_reserve_order\(TEXT,JSONB,UUID,BOOLEAN\)\s+TO\s+service_role/i.test(PARTIAL_SQL)).toBe(true);
  });
});

describe('00031 order-documents bucket', () => {
  it('creates a private order-documents bucket limited to PDFs', () => {
    expect(/INSERT\s+INTO\s+storage\.buckets[\s\S]+?'order-documents'[\s\S]+?false/i.test(DOC_BUCKET_SQL)).toBe(true);
    expect(/'application\/pdf'/i.test(DOC_BUCKET_SQL)).toBe(true);
  });

  it('grants SELECT on the bucket to ops roles only', () => {
    expect(/CREATE\s+POLICY\s+"order_documents_select_ops"[\s\S]*?bucket_id\s*=\s*'order-documents'[\s\S]*?IN\s*\(\s*'Admin'\s*,\s*'Manager'\s*,\s*'Warehouse'\s*\)/i.test(DOC_BUCKET_SQL)).toBe(true);
  });

  it('creates no write policies on the bucket (service_role only)', () => {
    expect(/CREATE\s+POLICY\s+"order_documents_(insert|update|delete|write)/i.test(DOC_BUCKET_SQL)).toBe(false);
  });
});

describe('00032 warehouse read access', () => {
  it.each(['orders', 'order_items', 'horecas'])('grants Warehouse SELECT on %s', (table) => {
    expect(new RegExp(`CREATE\\s+POLICY\\s+"${table}_select_warehouse"\\s+ON\\s+public\\.${table}\\s+FOR\\s+SELECT`, 'i').test(WAREHOUSE_SQL)).toBe(true);
    expect(new RegExp(`"${table}_select_warehouse"[\\s\\S]*?'Warehouse'`, 'i').test(WAREHOUSE_SQL)).toBe(true);
  });

  it('grants no write policies (read-only consumer)', () => {
    expect(/FOR\s+(INSERT|UPDATE|DELETE)/i.test(WAREHOUSE_SQL)).toBe(false);
  });
});

describe('00033 pick tolerates unreserved orders', () => {
  it('redefines inv_pick_order_line', () => {
    expect(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.inv_pick_order_line\b/i.test(PICK_TOLERATE_SQL)).toBe(true);
  });

  it('draws from physical on_hand (not allocated) in the FIFO loop', () => {
    expect(/WHERE\s+b\.product_id\s*=\s*v_item\.product_id\s+AND\s+b\.location_id\s*=\s*v_loc\s+AND\s+b\.on_hand\s*>\s*0/i.test(PICK_TOLERATE_SQL)).toBe(true);
    // The old allocated>0 gate must be gone from this definition.
    expect(/b\.allocated\s*>\s*0/i.test(PICK_TOLERATE_SQL)).toBe(false);
  });

  it('releases reservation only up to what is held (never negative)', () => {
    expect(/v_dealloc\s*:=\s*LEAST\(\s*v_take\s*,\s*v_row\.allocated\s*\)/i.test(PICK_TOLERATE_SQL)).toBe(true);
  });

  it('raises INSUFFICIENT_STOCK on a genuine physical shortage (not INSUFFICIENT_ALLOCATED)', () => {
    expect(/RAISE\s+EXCEPTION\s+'INSUFFICIENT_STOCK/i.test(PICK_TOLERATE_SQL)).toBe(true);
    // The function must no longer RAISE the allocation-specific error (the
    // header comment may still reference it for historical context).
    expect(/RAISE\s+EXCEPTION\s+'INSUFFICIENT_ALLOCATED/i.test(PICK_TOLERATE_SQL)).toBe(false);
  });

  it('keeps the OVER_PICK guard and scoped FOR UPDATE OF b lock', () => {
    expect(/RAISE\s+EXCEPTION\s+'OVER_PICK/i.test(PICK_TOLERATE_SQL)).toBe(true);
    expect(/FOR\s+UPDATE\s+OF\s+b/i.test(PICK_TOLERATE_SQL)).toBe(true);
  });

  it('keeps EXECUTE locked to service_role', () => {
    expect(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.inv_pick_order_line\(INT,NUMERIC,UUID\)\s+TO\s+service_role/i.test(PICK_TOLERATE_SQL)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 00083 / 00085 — two functions redefined with CREATE OR REPLACE.
//
// The repo's documented trap is that CREATE OR REPLACE with a CHANGED signature
// creates a SECOND overload instead of replacing (inv_transfer_stock and
// inv_receive_stock were both silently duplicated that way). Both migrations
// below rely on the signature being unchanged, so a future edit that adds or
// reorders a parameter without a DROP would be a silent, runtime-only break.
// These guard exactly that.
// ─────────────────────────────────────────────────────────────────────────────

describe('00083 order allocation prefers the pick zone', () => {
  it('keeps the 5-arg signature so CREATE OR REPLACE really replaces', () => {
    expect(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.inv_reserve_order\s*\(\s*p_order_id\s+TEXT/i.test(PICK_ZONE_SQL),
    ).toBe(true);
    expect(/p_allow_partial\s+BOOLEAN/i.test(PICK_ZONE_SQL)).toBe(true);
  });

  it('does NOT drop the function — a DROP would discard its service_role GRANT', () => {
    expect(/DROP\s+FUNCTION[^\n]*inv_reserve_order/i.test(PICK_ZONE_SQL)).toBe(false);
  });

  it('puts the pick-zone preference INSIDE the expiry tier, never above it', () => {
    // This ordering is the entire correctness argument of the migration: FEFO
    // first, preference only as a tie-break within one expiry date. Flipping
    // the two terms would let a newer batch jump an older one.
    //
    // Strip comment lines first — the file's header PROSE also contains an
    // "ORDER BY bt.expiry_date ..." sketch, and the trailing ROLLBACK note
    // quotes the OLD ordering. Matching those instead of the real clause is
    // exactly how this test passed vacuously the first time it was written.
    const sql = PICK_ZONE_SQL.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    const order = sql.match(/ORDER\s+BY[\s\S]*?b\.id/i)?.[0] ?? '';
    const expiryAt = order.search(/expiry_date/i);
    const caseAt = order.search(/is_pick_zone/i);
    const receivedAt = order.search(/received_at/i);
    expect(expiryAt).toBeGreaterThanOrEqual(0);
    expect(caseAt).toBeGreaterThan(expiryAt);
    expect(receivedAt).toBeGreaterThan(caseAt);
  });

  it('COALESCEs is_pick_zone so a legacy NULL level_role does not poison the sort', () => {
    expect(/COALESCE\s*\(\s*lr\.is_pick_zone\s*,\s*false\s*\)/i.test(PICK_ZONE_SQL)).toBe(true);
  });
});

describe('00085 rack conversion carries the handling unit', () => {
  it('keeps the 4-arg signature so CREATE OR REPLACE really replaces', () => {
    expect(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.wie_convert_rack_to_levels_tx\s*\(\s*p_location_id\s+integer/i
        .test(RACK_HU_SQL),
    ).toBe(true);
  });

  it('does NOT drop the function — a DROP would discard 00072 GRANTs', () => {
    expect(/DROP\s+FUNCTION[^\n]*wie_convert_rack_to_levels_tx/i.test(RACK_HU_SQL)).toBe(false);
  });

  it('selects handling_unit_id and threads it through BOTH legs by name', () => {
    // Named, not positional: p_handling_unit_id is the 12th parameter of
    // inv_apply_leg and p_supplier_id is the 11th, so a positional call would
    // silently bind the wrong one.
    expect(/SELECT\s+product_id,\s*batch_id,\s*handling_unit_id,\s*on_hand,\s*allocated/i.test(RACK_HU_SQL)).toBe(true);
    const named = RACK_HU_SQL.match(/p_handling_unit_id\s*=>\s*v_bal\.handling_unit_id/gi) ?? [];
    expect(named.length).toBe(2);
  });
});
