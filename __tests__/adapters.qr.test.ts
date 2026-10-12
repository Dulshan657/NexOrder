import { describe, it, expect } from 'vitest'
import { qrOrderRequestFromRow, qrStaffFromRow, toOrder, type QrOrderRequestRow } from '@/lib/adapters'
import { uuidToNumericId } from '@/lib/userIdMap'

const row = (over: Partial<QrOrderRequestRow> = {}): QrOrderRequestRow => ({
  id: 'r1',
  horeca_id: 7,
  requested_by: 'u1',
  qr_staff_id: 's1',
  staff_name: 'Sam',
  status: 'pending',
  items: [{ productId: 3, quantity: 2, packSize: 12, uomId: null, productName: 'Milk 1L', productSku: 'MLK1' }],
  notes: 'Back door',
  delivery_date: '2026-10-14',
  delivery_time_slot: 'Morning (8am-12pm)',
  delivery_address: { street: '1 High St', city: 'Sydney', postcode: '2000', country: null, recipient_name: 'Kitchen' },
  quoted_total: 42.5,
  created_at: '2026-10-12T00:00:00Z',
  decided_at: null,
  decided_by: null,
  decision_reason: null,
  last_error: null,
  edited_by_approver: false,
  approved_order_id: null,
  ...over,
})

describe('qrStaffFromRow', () => {
  it('maps the granted columns and nothing else', () => {
    expect(
      qrStaffFromRow({
        id: 's1',
        horeca_id: 7,
        name: 'Sam',
        unlocked_until: '2026-10-12T12:00:00Z',
        last_unlocked_at: '2026-10-12T10:00:00Z',
        created_at: '2026-10-01T00:00:00Z',
        revoked_at: null,
      }),
    ).toEqual({
      id: 's1',
      horecaId: 7,
      name: 'Sam',
      unlockedUntil: '2026-10-12T12:00:00Z',
      lastUnlockedAt: '2026-10-12T10:00:00Z',
      createdAt: '2026-10-01T00:00:00Z',
      revokedAt: null,
    })
  })

  it('keeps a never-unlocked member as nulls', () => {
    const s = qrStaffFromRow({
      id: 's1', horeca_id: 7, name: 'Sam', unlocked_until: null, last_unlocked_at: null, created_at: 'x', revoked_at: null,
    })
    expect(s.unlockedUntil).toBeNull()
    expect(s.lastUnlockedAt).toBeNull()
  })
})

describe('qrOrderRequestFromRow', () => {
  it('maps every field to camelCase', () => {
    expect(qrOrderRequestFromRow(row())).toEqual({
      id: 'r1',
      horecaId: 7,
      requestedBy: 'u1',
      qrStaffId: 's1',
      staffName: 'Sam',
      status: 'pending',
      items: [{ productId: 3, quantity: 2, packSize: 12, uomId: null, productName: 'Milk 1L', productSku: 'MLK1' }],
      notes: 'Back door',
      deliveryDate: '2026-10-14',
      deliveryTimeSlot: 'Morning (8am-12pm)',
      deliveryAddress: { street: '1 High St', city: 'Sydney', postcode: '2000', country: null, recipientName: 'Kitchen' },
      quotedTotal: 42.5,
      createdAt: '2026-10-12T00:00:00Z',
      decidedAt: null,
      decidedBy: null,
      decisionReason: null,
      lastError: null,
      editedByApprover: false,
      approvedOrderId: null,
    })
  })

  it('reads a NUMERIC that PostgREST sent as a string', () => {
    expect(qrOrderRequestFromRow(row({ quoted_total: '12.50' })).quotedTotal).toBe(12.5)
    expect(qrOrderRequestFromRow(row({ quoted_total: null })).quotedTotal).toBe(0)
  })

  it('treats an address with no street as absent', () => {
    expect(qrOrderRequestFromRow(row({ delivery_address: { street: '', city: 'x' } })).deliveryAddress).toBeNull()
    expect(qrOrderRequestFromRow(row({ delivery_address: null })).deliveryAddress).toBeNull()
  })

  it('maps an unrecognised status to the inert "cancelled", never to something actionable', () => {
    expect(qrOrderRequestFromRow(row({ status: 'on_hold' })).status).toBe('cancelled')
    for (const s of ['pending', 'approving', 'approved', 'rejected', 'cancelled']) {
      expect(qrOrderRequestFromRow(row({ status: s })).status).toBe(s)
    }
  })

  it('a pre-snapshot row (no staff_name) reads as an empty name', () => {
    expect(qrOrderRequestFromRow(row({ staff_name: null })).staffName).toBe('')
  })

  it('keeps well-formed lines and drops malformed ones, without throwing', () => {
    const r = qrOrderRequestFromRow(
      row({
        items: [
          { productId: 1, quantity: 1 },
          null,
          'junk',
          { productId: '2', quantity: 3 },
          { productId: 4, quantity: 5, packSize: 'x', uomId: 9 },
        ],
      }),
    )
    expect(r.items).toEqual([
      { productId: 1, quantity: 1, packSize: null, uomId: null },
      { productId: 4, quantity: 5, packSize: null, uomId: 9 },
    ])
  })

  it('a non-array items column reads as no lines', () => {
    expect(qrOrderRequestFromRow(row({ items: null })).items).toEqual([])
    expect(qrOrderRequestFromRow(row({ items: { a: 1 } })).items).toEqual([])
  })

  it('carries the decision and the approved order', () => {
    const r = qrOrderRequestFromRow(
      row({
        status: 'approved',
        decided_at: '2026-10-12T01:00:00Z',
        decided_by: 'u9',
        edited_by_approver: true,
        approved_order_id: 'ORD-5',
      }),
    )
    expect(r).toMatchObject({ status: 'approved', decidedBy: 'u9', editedByApprover: true, approvedOrderId: 'ORD-5' })
  })
})

describe('orders: the qr_order_requests embed', () => {
  const UUID = '11111111-2222-3333-4444-555555555555'
  const hoReCas = [{ id: 7, name: 'Cafe One', address: 'x' }] as never[]
  const users = [{ id: uuidToNumericId(UUID), name: 'Sam', email: 's@x', role: 'QR Staff' }] as never[]

  const orderRow = (extra: Record<string, unknown> = {}) =>
    ({
      id: 'ORD-1',
      horeca_id: 7,
      submitted_by: UUID,
      order_date: '2026-10-12T00:00:00Z',
      status: 'pending',
      total: 10,
      order_items: [],
      ...extra,
    }) as never

  it('maps an object embed to order.qrRequest', () => {
    const o = toOrder(orderRow({ qr_order_requests: { staff_name: 'Sam' } }), hoReCas, users, [])
    expect(o.qrRequest).toEqual({ staffName: 'Sam' })
  })

  it('tolerates the array spelling', () => {
    const o = toOrder(orderRow({ qr_order_requests: [{ staff_name: 'Sam' }] }), hoReCas, users, [])
    expect(o.qrRequest).toEqual({ staffName: 'Sam' })
  })

  it('is absent when the embed is null (RLS hid it, or it is an ordinary order)', () => {
    expect(toOrder(orderRow({ qr_order_requests: null }), hoReCas, users, []).qrRequest).toBeUndefined()
    expect(toOrder(orderRow(), hoReCas, users, []).qrRequest).toBeUndefined()
  })

  it('a null snapshot name still marks the order as QR', () => {
    const o = toOrder(orderRow({ qr_order_requests: { staff_name: null } }), hoReCas, users, [])
    expect(o.qrRequest).toEqual({ staffName: '' })
  })
})
