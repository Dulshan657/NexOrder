import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase client singleton before importing the service. `vi.hoisted`
// so the factory (hoisted to the top) can reference the spies.
const { invoke, verifyOtp, signOut, from } = vi.hoisted(() => ({
  invoke: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke }, auth: { verifyOtp, signOut }, from },
}))

import {
  QrApiError,
  approveQrRequest,
  cancelQrRequest,
  createQrStaff,
  fetchQrPoster,
  getQrAccess,
  listQrRequests,
  listQrStaff,
  previewQrRequest,
  regenerateQrCode,
  rejectQrRequest,
  renameQrStaff,
  resolveQr,
  resetQrPin,
  revokeQrStaff,
  signInWithQrPin,
  signOutQrLocally,
  submitQrRequest,
  unlockQr,
  unlockQrCode,
} from '../services/supabase/qrService'

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345'

function httpError(status: number, body: unknown): Error {
  const err = new Error('Edge Function returned a non-2xx status code')
  ;(err as Error & { context: Response }).context = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return err
}

const ok = (data: unknown) => invoke.mockResolvedValue({ data, error: null })
const fail = (status: number, code: string, message: string, details?: unknown) =>
  invoke.mockResolvedValue({ data: null, error: httpError(status, { error: { code, message, details } }) })

/** The body of the last invoke call. */
const lastBody = () => invoke.mock.calls.at(-1)![1].body
const lastFn = () => invoke.mock.calls.at(-1)![0]

beforeEach(() => {
  invoke.mockReset()
  verifyOtp.mockReset()
  signOut.mockReset()
  from.mockReset()
})

describe('every call', () => {
  it('passes an explicit timeout, so the 20s fetch ceiling does not cut an approval short', async () => {
    ok({ ok: true })
    await unlockQrCode(1)
    expect(invoke.mock.calls[0][1].timeout).toBeGreaterThanOrEqual(20_000)
    await approveQrRequest({ requestId: 'r' }).catch(() => {})
    expect(invoke.mock.calls[1][1].timeout).toBeGreaterThan(30_000)
  })

  it('throws a QrApiError carrying the server code, not the generic message', async () => {
    fail(409, 'QR_PIN_TAKEN', 'Another person here already uses that PIN. Choose a different one.')
    const err = await createQrStaff({ horecaId: 1, name: 'Sam', pin: '4821' }).catch((e) => e)
    expect(err).toBeInstanceOf(QrApiError)
    expect(err.code).toBe('QR_PIN_TAKEN')
    expect(err.message).toBe('Another person here already uses that PIN. Choose a different one.')
    expect(err.status).toBe(409)
  })

  it('maps a call that never got a response to NETWORK', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to send a request to the Edge Function') })
    const err = await resolveQr(TOKEN).catch((e) => e)
    expect(err.code).toBe('NETWORK')
    expect(err.status).toBeNull()
  })

  it('treats an empty success body as an error rather than returning undefined', async () => {
    invoke.mockResolvedValue({ data: null, error: null })
    await expect(resolveQr(TOKEN)).rejects.toMatchObject({ code: 'INTERNAL' })
  })
})

describe('qr-unlock (before login)', () => {
  it('resolve sends the token and returns the venue, including its id', async () => {
    const venue = { horecaId: 7, horecaName: 'Cafe One', logoUrl: null, companyName: 'Acme', phone: '02 5550 1234' }
    ok(venue)
    await expect(resolveQr(TOKEN)).resolves.toEqual(venue)
    expect(lastFn()).toBe('qr-unlock')
    expect(lastBody()).toEqual({ action: 'resolve', token: TOKEN })
  })

  it('unlock sends token + pin', async () => {
    ok({ ok: true, tokenHash: 'h', expiresAt: '2026-10-12T12:00:00Z', staffName: 'Sam', horecaId: 7 })
    const r = await unlockQr(TOKEN, '4821')
    expect(lastBody()).toEqual({ action: 'unlock', token: TOKEN, pin: '4821' })
    expect(r.tokenHash).toBe('h')
  })

  it('a wrong PIN surfaces QR_BAD_PIN with no attempt count', async () => {
    fail(401, 'QR_BAD_PIN', 'Incorrect PIN')
    const err = await unlockQr(TOKEN, '9999').catch((e) => e)
    expect(err.code).toBe('QR_BAD_PIN')
    expect(err.locked).toBe(false)
  })

  it('a locked code surfaces lockedUntil and permanent', async () => {
    fail(423, 'QR_LOCKED', 'Too many incorrect PINs. Try again later.', {
      lockedUntil: '2026-10-12T10:15:00.000Z',
      permanent: false,
    })
    const err = await unlockQr(TOKEN, '4821').catch((e) => e)
    expect(err.locked).toBe(true)
    expect(err.lockedUntil).toBe('2026-10-12T10:15:00.000Z')
    expect(err.permanent).toBe(false)
  })

  it('signInWithQrPin exchanges the hashed token for a session with type magiclink', async () => {
    ok({ ok: true, tokenHash: 'hashed-1', expiresAt: '2026-10-12T12:00:00Z', staffName: 'Sam', horecaId: 7 })
    verifyOtp.mockResolvedValue({ data: {}, error: null })
    const r = await signInWithQrPin(TOKEN, '4821')
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'hashed-1', type: 'magiclink' })
    expect(r.staffName).toBe('Sam')
  })

  it('signInWithQrPin does not call verifyOtp when the PIN is wrong', async () => {
    fail(401, 'QR_BAD_PIN', 'Incorrect PIN')
    await expect(signInWithQrPin(TOKEN, '0000')).rejects.toMatchObject({ code: 'QR_BAD_PIN' })
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('signInWithQrPin turns a failed session exchange into a QrApiError', async () => {
    ok({ ok: true, tokenHash: 'h', expiresAt: 'x', staffName: 'Sam', horecaId: 7 })
    verifyOtp.mockResolvedValue({ data: {}, error: { message: 'token has expired or is invalid' } })
    const err = await signInWithQrPin(TOKEN, '4821').catch((e) => e)
    expect(err).toBeInstanceOf(QrApiError)
    expect(err.message).toBe('Could not start your session. Try again.')
  })

  it('signOutQrLocally clears only the local session and never throws', async () => {
    signOut.mockResolvedValue({ error: null })
    await signOutQrLocally()
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    signOut.mockRejectedValue(new Error('boom'))
    await expect(signOutQrLocally()).resolves.toBeUndefined()
  })
})

describe('mutate-qr-access', () => {
  it('get maps staff onto QrStaff with the venue id and no revocation', async () => {
    ok({
      ok: true,
      horecaId: 7,
      horecaName: 'Cafe One',
      token: TOKEN,
      url: `https://app.example/?qr=${TOKEN}`,
      staff: [{ id: 's1', name: 'Sam', unlockedUntil: null, lastUnlockedAt: null, createdAt: '2026-10-01T00:00:00Z' }],
      locked: false,
      lockedUntil: null,
      permanent: false,
      failedAttempts: 0,
    })
    const state = await getQrAccess(7)
    expect(lastFn()).toBe('mutate-qr-access')
    expect(lastBody()).toEqual({ action: 'get', horecaId: 7 })
    expect(state.url).toContain(TOKEN)
    expect(state.staff).toEqual([
      {
        id: 's1',
        name: 'Sam',
        unlockedUntil: null,
        lastUnlockedAt: null,
        createdAt: '2026-10-01T00:00:00Z',
        horecaId: 7,
        revokedAt: null,
      },
    ])
  })

  it('regenerate_code, unlock_code', async () => {
    ok({ ok: true, horecaId: 7, token: TOKEN, url: 'u', sessionsEnded: 2, sessionsFailed: 0 })
    const r = await regenerateQrCode(7)
    expect(lastBody()).toEqual({ action: 'regenerate_code', horecaId: 7 })
    expect(r.sessionsEnded).toBe(2)
    ok({ ok: true })
    await unlockQrCode(7)
    expect(lastBody()).toEqual({ action: 'unlock_code', horecaId: 7 })
  })

  it('create_staff returns a QrStaff stamped with the venue', async () => {
    ok({
      ok: true,
      staff: { id: 's2', name: 'Alex', unlockedUntil: null, lastUnlockedAt: null, createdAt: '2026-10-12T00:00:00Z' },
    })
    const s = await createQrStaff({ horecaId: 7, name: 'Alex', pin: '4821' })
    expect(lastBody()).toEqual({ action: 'create_staff', horecaId: 7, name: 'Alex', pin: '4821' })
    expect(s).toMatchObject({ id: 's2', horecaId: 7, revokedAt: null, name: 'Alex' })
  })

  it('a weak PIN is QR_WEAK_PIN', async () => {
    fail(400, 'QR_WEAK_PIN', 'That PIN is too easy to guess. Avoid repeats, runs like 1234, and years.')
    await expect(createQrStaff({ horecaId: 7, name: 'Alex', pin: '1234' })).rejects.toMatchObject({
      code: 'QR_WEAK_PIN',
    })
  })

  it('rename_staff, reset_pin, revoke_staff', async () => {
    ok({ ok: true, staff: { id: 's1', name: 'Samantha' } })
    await expect(renameQrStaff('s1', 'Samantha')).resolves.toEqual({ id: 's1', name: 'Samantha' })
    expect(lastBody()).toEqual({ action: 'rename_staff', staffId: 's1', name: 'Samantha' })

    ok({ ok: true, sessionsEnded: true })
    await expect(resetQrPin('s1', '4821')).resolves.toEqual({ sessionsEnded: true })
    expect(lastBody()).toEqual({ action: 'reset_pin', staffId: 's1', pin: '4821' })

    ok({ ok: true })
    await revokeQrStaff('s1')
    expect(lastBody()).toEqual({ action: 'revoke_staff', staffId: 's1' })
  })
})

describe('generate-qr-poster', () => {
  it('returns the PDF blob and asks for the right format', async () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' })
    ok(blob)
    await expect(fetchQrPoster(7, 'a4')).resolves.toBe(blob)
    expect(lastFn()).toBe('generate-qr-poster')
    expect(lastBody()).toEqual({ horecaId: 7, format: 'a4' })
  })

  it('refuses a non-PDF success body', async () => {
    ok({ ok: true })
    await expect(fetchQrPoster(7, 'sticker')).rejects.toMatchObject({ code: 'INTERNAL' })
  })

  it('surfaces a missing code as NOT_FOUND with the server message', async () => {
    fail(404, 'NOT_FOUND', 'Open QR & PINs first to create the code')
    await expect(fetchQrPoster(7, 'a4')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Open QR & PINs first to create the code',
    })
  })
})

describe('qr-order-request', () => {
  it('submit converts the address to the wire shape and nulls absent optionals', async () => {
    ok({ ok: true, requestId: 'r1', quotedTotal: 42.5, status: 'pending', createdAt: '2026-10-12T00:00:00Z' })
    const r = await submitQrRequest({
      items: [{ productId: 3, quantity: 2, packSize: 12, uomId: null }],
      deliveryDate: '2026-10-14',
      deliveryTimeSlot: 'Morning (8am-12pm)',
      deliveryAddress: { street: '1 High St', city: 'Sydney', recipientName: 'Kitchen' },
    })
    expect(lastFn()).toBe('qr-order-request')
    expect(lastBody()).toEqual({
      action: 'submit',
      items: [{ productId: 3, quantity: 2, packSize: 12, uomId: null }],
      notes: null,
      deliveryDate: '2026-10-14',
      deliveryTimeSlot: 'Morning (8am-12pm)',
      deliveryAddress: { street: '1 High St', city: 'Sydney', postcode: null, country: null, recipient_name: 'Kitchen' },
    })
    expect(r.requestId).toBe('r1')
  })

  it('submit with nothing optional sends nulls, not undefined', async () => {
    ok({ ok: true, requestId: 'r1', quotedTotal: 0, status: 'pending', createdAt: 'x' })
    await submitQrRequest({ items: [{ productId: 3, quantity: 1 }] })
    expect(lastBody()).toMatchObject({ notes: null, deliveryDate: null, deliveryTimeSlot: null, deliveryAddress: null })
  })

  it('a bad payload surfaces field issues', async () => {
    fail(400, 'INVALID_INPUT', 'Invalid request body', [{ path: 'items.0.quantity', message: 'Number must be greater than 0' }])
    const err = await submitQrRequest({ items: [{ productId: 3, quantity: 0 }] }).catch((e) => e)
    expect(err.issues).toEqual([{ path: 'items.0.quantity', message: 'Number must be greater than 0' }])
  })

  it('an expired unlock is sessionEnded', async () => {
    fail(401, 'QR_SESSION_EXPIRED', 'Your kitchen session has ended')
    const err = await submitQrRequest({ items: [{ productId: 3, quantity: 1 }] }).catch((e) => e)
    expect(err.sessionEnded).toBe(true)
  })

  it('cancel and reject send the request id', async () => {
    ok({ ok: true })
    await cancelQrRequest('r1')
    expect(lastBody()).toEqual({ action: 'cancel', requestId: 'r1' })
    await rejectQrRequest('r1', 'Out of season')
    expect(lastBody()).toEqual({ action: 'reject', requestId: 'r1', reason: 'Out of season' })
  })

  it('cancel losing the race surfaces where the request stands', async () => {
    fail(409, 'QR_REQUEST_CONFLICT', 'That order was already approved', { status: 'approved' })
    const err = await cancelQrRequest('r1').catch((e) => e)
    expect(err.code).toBe('QR_REQUEST_CONFLICT')
    expect(err.requestStatus).toBe('approved')
  })

  it('approve sends edits only when given, and notes only when given', async () => {
    const result = {
      ok: true,
      requestId: 'r1',
      status: 'approved',
      orderId: 'ORD-9',
      total: 50,
      cartDiscount: 0,
      appliedPromotionIds: [],
      bogoFreeItems: [],
      editedByApprover: false,
    }
    ok(result)
    await approveQrRequest({ requestId: 'r1' })
    expect(lastBody()).toEqual({ action: 'approve', requestId: 'r1' })

    await approveQrRequest({ requestId: 'r1', items: [{ productId: 3, quantity: 5 }], notes: '' })
    expect(lastBody()).toEqual({
      action: 'approve',
      requestId: 'r1',
      items: [{ productId: 3, quantity: 5 }],
      notes: '',
    })
  })

  it('approve surfaces the stock refusal and keeps its details', async () => {
    fail(409, 'INSUFFICIENT_STOCK', '19 of "Coconut Milk 400ml" available, 25 requested', { productId: 3 })
    const err = await approveQrRequest({ requestId: 'r1' }).catch((e) => e)
    expect(err.code).toBe('INSUFFICIENT_STOCK')
    expect(err.details).toEqual({ productId: 3 })
  })

  it('approve flags an order that was placed but not linked', async () => {
    fail(500, 'INTERNAL', 'Order ORD-9 was placed, but this request could not be marked approved.', { orderId: 'ORD-9' })
    const err = await approveQrRequest({ requestId: 'r1' }).catch((e) => e)
    expect(err.orderId).toBe('ORD-9')
  })

  it('preview returns the adapted request and the priced preview', async () => {
    ok({
      ok: true,
      request: {
        id: 'r1',
        horeca_id: 7,
        requested_by: 'u1',
        qr_staff_id: 's1',
        staff_name: 'Sam',
        status: 'pending',
        items: [{ productId: 3, quantity: 2, packSize: null, uomId: null, productName: 'Milk' }],
        notes: null,
        delivery_date: null,
        delivery_time_slot: null,
        delivery_address: null,
        quoted_total: '12.50',
        created_at: '2026-10-12T00:00:00Z',
        decided_at: null,
        decided_by: null,
        decision_reason: null,
        last_error: null,
        edited_by_approver: false,
        approved_order_id: null,
        claimed_at: null,
        verification: null,
      },
      preview: { ok: true, problems: [], lines: [], stock: [], total: 12.5 },
    })
    const r = await previewQrRequest('r1', [{ productId: 3, quantity: 2 }])
    expect(lastBody()).toEqual({ action: 'preview', requestId: 'r1', items: [{ productId: 3, quantity: 2 }] })
    expect(r.request).toMatchObject({ id: 'r1', staffName: 'Sam', quotedTotal: 12.5, horecaId: 7 })
    expect(r.preview?.ok).toBe(true)
  })

  it('preview of a decided request has no preview', async () => {
    ok({ ok: true, request: { id: 'r1', horeca_id: 7, status: 'approved', items: [], created_at: 'x' }, preview: null })
    expect((await previewQrRequest('r1')).preview).toBeNull()
    expect(lastBody()).toEqual({ action: 'preview', requestId: 'r1' })
  })
})

// A thenable PostgREST builder: every chained call returns itself and records
// what it was asked, and awaiting it yields the canned result.
function builder(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = []
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args])
      return b
    }
  }
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return { b, calls }
}

describe('PostgREST reads', () => {
  it('listQrStaff names its columns (select=* is refused by the grant) and drops revoked staff', async () => {
    const { b, calls } = builder({
      data: [
        {
          id: 's1',
          horeca_id: 7,
          name: 'Sam',
          unlocked_until: '2026-10-12T12:00:00Z',
          last_unlocked_at: '2026-10-12T10:00:00Z',
          created_at: '2026-10-01T00:00:00Z',
          revoked_at: null,
        },
      ],
      error: null,
    })
    from.mockReturnValue(b)
    const staff = await listQrStaff(7)
    expect(from).toHaveBeenCalledWith('qr_staff')
    const select = calls.find(([m]) => m === 'select')![1][0] as string
    expect(select).not.toContain('*')
    expect(select.split(',').map((s) => s.trim())).toEqual([
      'id', 'horeca_id', 'name', 'unlocked_until', 'last_unlocked_at', 'created_at', 'revoked_at',
    ])
    expect(select).not.toMatch(/pin_hmac|auth_user_id/)
    expect(calls).toContainEqual(['eq', ['horeca_id', 7]])
    expect(calls).toContainEqual(['is', ['revoked_at', null]])
    expect(staff[0]).toMatchObject({ id: 's1', horecaId: 7, unlockedUntil: '2026-10-12T12:00:00Z', revokedAt: null })
  })

  it('listQrRequests filters by venue and status, newest first, and selects explicit columns', async () => {
    const { b, calls } = builder({ data: [], error: null })
    from.mockReturnValue(b)
    await listQrRequests({ horecaId: 7, status: 'pending' })
    expect(from).toHaveBeenCalledWith('qr_order_requests')
    expect((calls.find(([m]) => m === 'select')![1][0] as string)).not.toContain('*')
    expect(calls).toContainEqual(['eq', ['horeca_id', 7]])
    expect(calls).toContainEqual(['eq', ['status', 'pending']])
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]])
  })

  it('listQrRequests accepts several statuses and no venue', async () => {
    const { b, calls } = builder({ data: [], error: null })
    from.mockReturnValue(b)
    await listQrRequests({ status: ['pending', 'approving'], limit: 5 })
    expect(calls).toContainEqual(['in', ['status', ['pending', 'approving']]])
    expect(calls).toContainEqual(['limit', [5]])
    expect(calls.some(([m, a]) => m === 'eq' && a[0] === 'horeca_id')).toBe(false)
  })

  it('a PostgREST error is thrown as-is', async () => {
    const { b } = builder({ data: null, error: { message: 'permission denied for table qr_staff', code: '42501' } })
    from.mockReturnValue(b)
    await expect(listQrStaff(7)).rejects.toMatchObject({ code: '42501' })
  })
})
