import { describe, it, expect } from 'vitest';

import {
  planInsertOrder,
  rewriteProjectRef,
  contentTypeFor,
} from '../scripts/lib/importPlan.mjs';
import { TEST_PROJECT_REF } from '../config/environments.mjs';

/** Shorthand for a foreign key edge. Nullable unless said otherwise. */
const fk = (child: string, parent: string, column: string, nullable = true) => ({
  child,
  parent,
  column,
  nullable,
});

/** Assert `order` never places a child before a parent it still depends on. */
function assertParentsFirst(
  order: string[],
  edges: ReturnType<typeof fk>[],
  deferred: Map<string, string[]>,
) {
  const position = new Map(order.map((t, i) => [t, i]));
  for (const e of edges) {
    if (e.child === e.parent) continue;
    if (deferred.get(e.child)?.includes(e.column)) continue;
    expect(
      position.get(e.child)!,
      `${e.child}.${e.column} -> ${e.parent} was inserted before its parent`,
    ).toBeGreaterThan(position.get(e.parent)!);
  }
}

describe('planInsertOrder', () => {
  it('orders parents before children', () => {
    const tables = ['order_items', 'orders', 'products'];
    const edges = [fk('order_items', 'orders', 'order_id', false), fk('order_items', 'products', 'product_id', false)];

    const { order, deferred } = planInsertOrder(tables, edges);

    expect(deferred.size).toBe(0);
    assertParentsFirst(order, edges, deferred);
  });

  it('is deterministic — same input, same plan', () => {
    const tables = ['c', 'a', 'b', 'd'];
    const edges = [fk('c', 'a', 'a_id'), fk('d', 'b', 'b_id')];

    const first = planInsertOrder(tables, edges).order;
    const second = planInsertOrder([...tables].reverse(), edges).order;

    expect(first).toEqual(second);
  });

  // The case the manifest's deferral list ignores entirely: a tree table whose
  // rows arrive in ctid order, so a bin can precede its rack.
  it('always defers a self-reference, whatever the row order', () => {
    const { order, deferred } = planInsertOrder(
      ['locations'],
      [fk('locations', 'locations', 'parent_id')],
    );

    expect(order).toEqual(['locations']);
    expect(deferred.get('locations')).toEqual(['parent_id']);
  });

  it('refuses a NOT NULL self-reference rather than emitting an impossible plan', () => {
    expect(() =>
      planInsertOrder(['node'], [fk('node', 'node', 'parent_id', false)]),
    ).toThrow(/NOT NULL self-reference/);
  });

  it('breaks a two-table cycle on a nullable column', () => {
    const edges = [
      fk('profiles', 'horecas', 'horeca_id'),
      fk('horecas', 'profiles', 'created_by_user_id'),
    ];

    const { order, deferred } = planInsertOrder(['profiles', 'horecas'], edges);

    expect(order).toHaveLength(2);
    // Exactly one side is broken — breaking both would be needless data edits.
    expect([...deferred.values()].flat()).toHaveLength(1);
    assertParentsFirst(order, edges, deferred);
  });

  // The whole reason this module exists rather than reusing the manifest: the
  // export's superset would have nulled `connected_by`, which is NOT NULL.
  it('never breaks a cycle on a NOT NULL column when a nullable one exists', () => {
    const edges = [
      fk('email_accounts', 'profiles', 'connected_by', false),
      fk('profiles', 'email_accounts', 'primary_account_id', true),
    ];

    const { deferred } = planInsertOrder(['email_accounts', 'profiles'], edges);

    expect(deferred.get('email_accounts')).toBeUndefined();
    expect(deferred.get('profiles')).toEqual(['primary_account_id']);
  });

  it('throws when a cycle has only NOT NULL edges to break on', () => {
    expect(() =>
      planInsertOrder(
        ['a', 'b'],
        [fk('a', 'b', 'b_id', false), fk('b', 'a', 'a_id', false)],
      ),
    ).toThrow(/no nullable foreign key to break on/);
  });

  it('ignores edges pointing outside the table set', () => {
    // auth.users is not in `public`, so its edge is not ours to order.
    const { order, deferred } = planInsertOrder(
      ['profiles'],
      [fk('profiles', 'users', 'id', false)],
    );

    expect(order).toEqual(['profiles']);
    expect(deferred.size).toBe(0);
  });

  it('resolves the real shape: locations <-> warehouse_layouts plus a self-ref', () => {
    const tables = ['locations', 'warehouse_layouts', 'layout_placements'];
    const edges = [
      fk('locations', 'locations', 'parent_id'),
      fk('locations', 'warehouse_layouts', 'created_in_layout_id'),
      fk('warehouse_layouts', 'locations', 'warehouse_id', false),
      fk('layout_placements', 'warehouse_layouts', 'layout_id', false),
      fk('layout_placements', 'locations', 'location_id', false),
    ];

    const { order, deferred } = planInsertOrder(tables, edges);

    // locations must come first, because warehouse_layouts.warehouse_id cannot
    // be nulled — so the cycle has to break on locations' nullable side.
    expect(order[0]).toBe('locations');
    expect(deferred.get('locations')).toContain('parent_id');
    expect(deferred.get('locations')).toContain('created_in_layout_id');
    assertParentsFirst(order, edges, deferred);
  });
});

describe('rewriteProjectRef', () => {
  const OLD = 'lsgkznyiabqitqfpveey';

  it('rewrites a ref buried inside a JSONB blob', () => {
    // Exactly the shape of the eight real hits: not a column, a value inside
    // orders.verification. A column-name-based rewrite would miss it.
    const rows = [
      {
        id: 1,
        verification: {
          method: 'signature',
          signatureDataUrl: `https://${OLD}.supabase.co/storage/v1/object/public/signatures/orders/x.png`,
        },
      },
    ];

    const { rows: out, replacements } = rewriteProjectRef(rows, OLD, TEST_PROJECT_REF);

    expect(replacements).toBe(1);
    expect(out[0].verification.signatureDataUrl).toBe(
      `https://${TEST_PROJECT_REF}.supabase.co/storage/v1/object/public/signatures/orders/x.png`,
    );
  });

  it('counts every occurrence, including several in one row', () => {
    const rows = [{ a: `${OLD}`, b: `x ${OLD} y ${OLD}` }];

    expect(rewriteProjectRef(rows, OLD, 'new').replacements).toBe(3);
  });

  it('returns the rows untouched when there is nothing to rewrite', () => {
    const rows = [{ id: 1, note: 'no refs here' }];

    const result = rewriteProjectRef(rows, OLD, 'new');

    expect(result.replacements).toBe(0);
    expect(result.rows).toBe(rows);
  });

  it('is a no-op when old and new refs are the same', () => {
    const rows = [{ url: `https://${OLD}.supabase.co` }];

    expect(rewriteProjectRef(rows, OLD, OLD).replacements).toBe(0);
  });

  it('does not mutate its input', () => {
    const rows = [{ url: `https://${OLD}.supabase.co` }];

    rewriteProjectRef(rows, OLD, 'new');

    expect(rows[0].url).toContain(OLD);
  });
});

describe('contentTypeFor', () => {
  const PO_ARCHIVE = [
    'message/rfc822',
    'application/octet-stream',
    'application/pdf',
    'application/json',
    'image/png',
  ];

  it('uses the inferred type when the bucket allows it', () => {
    expect(contentTypeFor('a/b/doc.pdf', PO_ARCHIVE)).toEqual({
      contentType: 'application/pdf',
      downgraded: false,
    });
  });

  // The one real object this exists for: a .gif in po-archive, which allows
  // octet-stream but not image/gif.
  it('downgrades to octet-stream when the real type is not allowed', () => {
    expect(contentTypeFor('x/1-signature.gif', PO_ARCHIVE)).toEqual({
      contentType: 'application/octet-stream',
      downgraded: true,
    });
  });

  it('returns null when neither the real type nor octet-stream is allowed', () => {
    // signatures allows image/png only — a stray .pdf there cannot be uploaded.
    expect(contentTypeFor('orders/x.pdf', ['image/png'])).toBeNull();
  });

  it('treats an unknown extension as octet-stream', () => {
    expect(contentTypeFor('a/b.weirdext', null)).toEqual({
      contentType: 'application/octet-stream',
      downgraded: false,
    });
  });

  it('handles a key with no extension at all', () => {
    expect(contentTypeFor('a/b/noextension', null)?.contentType).toBe(
      'application/octet-stream',
    );
  });

  it('is case-insensitive about the extension', () => {
    expect(contentTypeFor('a/B.PDF', PO_ARCHIVE)?.contentType).toBe('application/pdf');
  });
});
