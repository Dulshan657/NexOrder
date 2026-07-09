import { describe, it, expect, vi } from 'vitest'
import { releaseResidualOnDispatch } from '../supabase/functions/_shared/fulfillment'
import type { FulfillmentStatus } from '../supabase/functions/_shared/orderStatusRollup'

// ---------------------------------------------------------------------------
// supabase/functions/_shared/fulfillment.ts — releaseResidualOnDispatch
//
// update-order-status/index.ts (Mode B, per-warehouse advance) is a Deno Edge
// Function: it imports the real @supabase/supabase-js client from esm.sh and
// reads Deno.env at module load, so index.ts itself cannot be imported under
// vitest/Node. The dispatch-release call it makes is extracted here into a
// small helper (mirroring the existing isLocationFullyPicked/
// recomputeOrderStatus helpers already in this module, which the edge function
// delegates to for the same reason) so the actual decision logic — call
// inv_release_reservation on a dispatch transition, and only on dispatch — is
// directly testable with a fake `admin` client exposing just `.rpc()`.
// ---------------------------------------------------------------------------

function fakeAdmin() {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
  return { admin: { rpc } as any, rpc }
}

describe('releaseResidualOnDispatch', () => {
  it('calls inv_release_reservation, scoped to this order and warehouse, on a dispatched transition', async () => {
    const { admin, rpc } = fakeAdmin()

    await releaseResidualOnDispatch(admin, 'ORD-1005', 705, 'actor-1', 'dispatched')

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('inv_release_reservation', {
      p_order_id: 'ORD-1005',
      p_location_id: 705,
      p_actor: 'actor-1',
    })
  })

  it.each<FulfillmentStatus>(['processed', 'picked', 'packed', 'delivered'])(
    'does not call it for a %s transition',
    async (status) => {
      const { admin, rpc } = fakeAdmin()

      await releaseResidualOnDispatch(admin, 'ORD-1005', 705, 'actor-1', status)

      expect(rpc).not.toHaveBeenCalled()
    },
  )

  it('passes a null actor through unchanged (system/no-actor calls)', async () => {
    const { admin, rpc } = fakeAdmin()

    await releaseResidualOnDispatch(admin, 'ORD-1005', 705, null, 'dispatched')

    expect(rpc).toHaveBeenCalledWith('inv_release_reservation', {
      p_order_id: 'ORD-1005',
      p_location_id: 705,
      p_actor: null,
    })
  })
})
