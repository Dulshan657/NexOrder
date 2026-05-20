import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Text-parse smoke test for migration 00022 — alias origin tracing.
//
// The migration is additive: a nullable FK column + an index on each of the
// two alias tables. The existing 00018 lockdown (RLS enabled, no
// INSERT/UPDATE/DELETE policy, no GRANT) is already enough — this migration
// does NOT add REVOKE statements. If a future commit accidentally drops the
// pending_po_id column or its FK reference to pending_pos, these tests
// surface it before deploy.

const ROOT = resolve(__dirname, '..');
const SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/00022_po_aliases_origin.sql'),
  'utf8',
);

describe('00022_po_aliases_origin migration', () => {
  it('wraps changes in a BEGIN/COMMIT transaction', () => {
    expect(/^BEGIN;/m.test(SQL)).toBe(true);
    expect(/^COMMIT;/m.test(SQL)).toBe(true);
  });

  describe('po_customer_aliases', () => {
    it('adds the pending_po_id column with the FK to pending_pos', () => {
      expect(
        /ALTER\s+TABLE\s+public\.po_customer_aliases[\s\S]+?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+pending_po_id\s+UUID[\s\S]+?REFERENCES\s+public\.pending_pos\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i.test(SQL),
      ).toBe(true);
    });

    it('creates a partial index on pending_po_id (only non-null)', () => {
      expect(
        /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_po_customer_aliases_pending_po[\s\S]+?ON\s+public\.po_customer_aliases\s*\(pending_po_id\)[\s\S]+?WHERE\s+pending_po_id\s+IS\s+NOT\s+NULL/i.test(SQL),
      ).toBe(true);
    });
  });

  describe('po_product_aliases', () => {
    it('adds the pending_po_id column with the FK to pending_pos', () => {
      expect(
        /ALTER\s+TABLE\s+public\.po_product_aliases[\s\S]+?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+pending_po_id\s+UUID[\s\S]+?REFERENCES\s+public\.pending_pos\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i.test(SQL),
      ).toBe(true);
    });

    it('creates a partial index on pending_po_id (only non-null)', () => {
      expect(
        /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_po_product_aliases_pending_po[\s\S]+?ON\s+public\.po_product_aliases\s*\(pending_po_id\)[\s\S]+?WHERE\s+pending_po_id\s+IS\s+NOT\s+NULL/i.test(SQL),
      ).toBe(true);
    });
  });

  it('does not REVOKE on the alias tables (00018 lockdown is already in place)', () => {
    // Defensive: if a future commit accidentally adds a REVOKE, this test
    // will need a reasoned update (it's not WRONG to revoke, but it would
    // be a no-op since authenticated has never been granted DML).
    const revokeMatch = /REVOKE\s+[^;]*?\s+ON\s+public\.po_customer_aliases/i.exec(SQL);
    expect(revokeMatch).toBeNull();
  });
});
