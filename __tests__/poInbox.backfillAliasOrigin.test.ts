import { describe, it, expect } from 'vitest'

import { backfillAliasOrigin } from '../supabase/functions/_shared/poInbox/aliasResolver'
import { makeFakeSupabase } from './support/fakeSupabase'

// backfillAliasOrigin stamps pending_po_id onto alias rows that the resolver
// auto-created earlier in the same extraction. Failures are logged-but-swallowed
// (a missing origin link is cosmetic), so it must never throw.

const PENDING_PO_ID = 'pending-po-123'

describe('backfillAliasOrigin', () => {
  it('updates pending_po_id on each customer and product alias id', async () => {
    const { supa, db } = makeFakeSupabase()
    await backfillAliasOrigin(supa, PENDING_PO_ID, ['cust-1', 'cust-2'], ['prod-9'])

    expect(db.updates).toEqual([
      { table: 'po_customer_aliases', patch: { pending_po_id: PENDING_PO_ID }, eq: { column: 'id', value: 'cust-1' } },
      { table: 'po_customer_aliases', patch: { pending_po_id: PENDING_PO_ID }, eq: { column: 'id', value: 'cust-2' } },
      { table: 'po_product_aliases', patch: { pending_po_id: PENDING_PO_ID }, eq: { column: 'id', value: 'prod-9' } },
    ])
  })

  it('skips empty-string ids on both lists', async () => {
    const { supa, db } = makeFakeSupabase()
    await backfillAliasOrigin(supa, PENDING_PO_ID, ['', 'cust-1', ''], ['', 'prod-9'])

    expect(db.updates.map(u => u.eq.value)).toEqual(['cust-1', 'prod-9'])
  })

  it('swallows update errors and does not throw', async () => {
    const { supa } = makeFakeSupabase({
      updateErrors: { po_customer_aliases: 'boom', po_product_aliases: 'boom' },
    })
    await expect(
      backfillAliasOrigin(supa, PENDING_PO_ID, ['cust-1'], ['prod-9']),
    ).resolves.toBeUndefined()
  })

  it('is a no-op for empty id lists', async () => {
    const { supa, db } = makeFakeSupabase()
    await backfillAliasOrigin(supa, PENDING_PO_ID, [], [])
    expect(db.updates).toEqual([])
  })
})
