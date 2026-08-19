import { describe, it, expect } from 'vitest';
// Plain .mjs, and deliberately so: these are loaded by a node script as well as
// by this suite, so they cannot be .ts.
import {
  fatalFindings,
  findGrantViolations,
  formatBaselined,
  lockedTableNames,
} from '../scripts/lib/grantExpectations.mjs';
import { LOCKED_TABLES } from '../config/lockedTables.mjs';
import { GRANT_BASELINE } from '../config/grantBaseline.mjs';

const ALL_TABLES: ReadonlySet<string> = new Set(lockedTableNames());

/** Shorthand for one information_schema.role_table_grants row. */
function grant(table: string, grantee: string, privilege: string) {
  return { table_name: table, grantee, privilege_type: privilege };
}

describe('findGrantViolations', () => {
  it('passes a database where no client role can write to a locked table', () => {
    const rows = [
      grant('orders', 'authenticated', 'SELECT'),
      grant('order_items', 'authenticated', 'SELECT'),
      grant('invoices', 'authenticated', 'SELECT'),
      // service_role holds everything and always will — it bypasses RLS and
      // grants, and every Edge Function runs as it.
      grant('orders', 'service_role', 'DELETE'),
    ];
    expect(findGrantViolations(rows, ALL_TABLES)).toEqual([]);
  });

  it('catches DB-1 exactly as it stood before mig 00112', () => {
    // The real defect: 00001:1084 granted full CRUD to `authenticated` on both
    // tables and nothing ever revoked it.
    const rows = [
      grant('orders', 'authenticated', 'INSERT'),
      grant('orders', 'authenticated', 'UPDATE'),
      grant('orders', 'authenticated', 'DELETE'),
      grant('order_items', 'authenticated', 'INSERT'),
      grant('order_items', 'authenticated', 'UPDATE'),
      grant('order_items', 'authenticated', 'DELETE'),
      grant('orders', 'authenticated', 'SELECT'),
    ];
    const findings = findGrantViolations(rows, ALL_TABLES);
    expect(findings).toHaveLength(6);
    expect(findings.every((f: any) => f.kind === 'unexpected_grant')).toBe(true);
    expect(new Set(findings.map((f: any) => f.table))).toEqual(new Set(['orders', 'order_items']));
    // Every message must say what to do, because a finding nobody can act on
    // gets ignored the second time it appears.
    for (const f of findings as any[]) {
      expect(f.message).toContain('revoked');
    }
  });

  it('flags anon as well as authenticated', () => {
    // 00102's lesson: this project carries ALTER DEFAULT PRIVILEGES for anon,
    // authenticated and service_role, so anon can hold grants nobody wrote.
    const findings = findGrantViolations([grant('invoices', 'anon', 'DELETE')], ALL_TABLES);
    expect(findings).toHaveLength(1);
    expect(findings[0].grantee).toBe('anon');
  });

  it('ignores SELECT — this check is about writes only', () => {
    const rows = LOCKED_TABLES.map((e: any) => grant(e.table, 'authenticated', 'SELECT'));
    expect(findGrantViolations(rows, ALL_TABLES)).toEqual([]);
  });

  it("honours a table's declared exception without honouring it everywhere", () => {
    // profiles keeps UPDATE: 00011 revoked only the (role, horeca_id) COLUMNS,
    // so a user may still edit their own name. That is design, not drift.
    expect(findGrantViolations([grant('profiles', 'authenticated', 'UPDATE')], ALL_TABLES)).toEqual([]);
    // ...but the same privilege on a table with no exception is still a finding,
    // and profiles' other privileges are not covered by its exception either.
    expect(findGrantViolations([grant('profiles', 'authenticated', 'INSERT')], ALL_TABLES)).toHaveLength(1);
    expect(findGrantViolations([grant('orders', 'authenticated', 'UPDATE')], ALL_TABLES)).toHaveLength(1);
  });

  it('reports a locked table that is absent rather than passing it silently', () => {
    // A renamed table would otherwise make its expectation unfalsifiable: no
    // rows to compare, so no findings, so a clean run that checked nothing.
    const withoutOrders = new Set(ALL_TABLES);
    withoutOrders.delete('orders');
    const findings = findGrantViolations([], withoutOrders);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'missing_table', table: 'orders' });
  });

  it('ignores grants on tables it was never asked about', () => {
    expect(findGrantViolations([grant('some_other_table', 'authenticated', 'DELETE')], ALL_TABLES)).toEqual([]);
  });

  it('orders findings deterministically', () => {
    const rows = [
      grant('orders', 'authenticated', 'UPDATE'),
      grant('invoices', 'anon', 'DELETE'),
      grant('orders', 'anon', 'INSERT'),
    ];
    const findings = findGrantViolations(rows, ALL_TABLES);
    expect(findings.map((f: any) => `${f.table}/${f.grantee}/${f.privilege}`)).toEqual([
      'invoices/anon/DELETE',
      'orders/anon/INSERT',
      'orders/authenticated/UPDATE',
    ]);
  });
});

describe('config/lockedTables.mjs', () => {
  it('names orders and order_items — the tables DB-1 was about', () => {
    const names = lockedTableNames();
    expect(names).toContain('orders');
    expect(names).toContain('order_items');
  });

  it('lists every table once, with a function and a migration', () => {
    const names = lockedTableNames();
    expect(new Set(names).size).toBe(names.length);
    for (const entry of LOCKED_TABLES as any[]) {
      expect(entry.fn, entry.table).toBeTruthy();
      expect(entry.migration, entry.table).toMatch(/^\d{5}$/);
    }
  });
});

describe('the DB-3 baseline', () => {
  it('does not cover orders or order_items — that is what makes the check a proof', () => {
    // If either were baselined, check:grants would go green while DB-1 was
    // still open, which is precisely the failure the check exists to prevent.
    expect(GRANT_BASELINE.orders).toBeUndefined();
    expect(GRANT_BASELINE.order_items).toBeUndefined();
  });

  it('makes an inherited grant non-fatal but still reported', () => {
    // invoices/anon/DELETE is real on dev today and is recorded in the baseline.
    const findings = findGrantViolations([grant('invoices', 'anon', 'DELETE')], ALL_TABLES);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('baselined');
    expect(fatalFindings(findings)).toEqual([]);
    expect(formatBaselined(findings)).toContain('invoices');
  });

  it('keeps a grant on a fixed table fatal', () => {
    const findings = findGrantViolations([grant('orders', 'authenticated', 'DELETE')], ALL_TABLES);
    expect(findings[0].kind).toBe('unexpected_grant');
    expect(fatalFindings(findings)).toHaveLength(1);
  });

  it('fails a privilege the baseline does not list, on a table it does', () => {
    // The baseline is per (table, grantee, privilege), not per table: a NEW
    // privilege on an already-indebted table is still a regression.
    const withoutInsert = (GRANT_BASELINE.pantry_items?.authenticated ?? []) as string[];
    expect(withoutInsert).not.toContain('INSERT');
    const findings = findGrantViolations([grant('pantry_items', 'authenticated', 'INSERT')], ALL_TABLES);
    expect(fatalFindings(findings)).toHaveLength(1);
  });

  it('says nothing when there is no inherited debt to report', () => {
    expect(formatBaselined([])).toBeNull();
  });

  it('only names tables that are actually locked', () => {
    const locked = new Set(lockedTableNames());
    for (const table of Object.keys(GRANT_BASELINE)) {
      expect(locked.has(table), `${table} is baselined but not locked`).toBe(true);
    }
  });
});

describe('TRUNCATE', () => {
  it('is checked, because RLS cannot constrain it', () => {
    // Every "locked down" claim in this repo is about row-level access, and
    // TRUNCATE has no row for a policy to filter. It was the one write nobody
    // had ever revoked, from anyone, on any table.
    const findings = findGrantViolations([grant('orders', 'authenticated', 'TRUNCATE')], ALL_TABLES);
    expect(fatalFindings(findings)).toHaveLength(1);
  });
});
