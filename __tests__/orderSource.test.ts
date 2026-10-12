import { describe, it, expect } from 'vitest';
import { getOrderSource, getInboundApproval } from '../lib/orderSource';
import type { Order } from '../types';
import { UserRole } from '../types';
import { mkHoReCa, mkUser } from './fixtures';

const mkOrder = (overrides: Partial<Order> = {}): Order => ({
  id: 'ORD-TEST',
  hoReCa: mkHoReCa(),
  items: [],
  total: 0,
  orderDate: '2026-05-18T00:00:00Z',
  submittedBy: mkUser({ role: UserRole.CUSTOMER }),
  status: 'processing',
  statusHistory: [],
  ...overrides,
});

describe('getOrderSource', () => {
  describe('email_inbound precedence', () => {
    it("returns 'email_inbound' when inboundMessageId is set, regardless of role", () => {
      const order = mkOrder({
        inboundMessageId: '11111111-1111-1111-1111-111111111111',
        submittedBy: mkUser({ role: UserRole.ADMIN }),
      });

      const source = getOrderSource(order);

      expect(source.key).toBe('email_inbound');
      expect(source.label).toBe('Email PO');
      expect(source.tone).toBe('teal');
    });

    it("returns 'email_inbound' even when HoReCa would otherwise resolve to walk_in", () => {
      const order = mkOrder({
        inboundMessageId: '22222222-2222-2222-2222-222222222222',
        hoReCa: mkHoReCa({ isTemporary: true }),
      });

      expect(getOrderSource(order).key).toBe('email_inbound');
    });
  });

  describe('qr_kitchen', () => {
    const TOKEN_ROLE = UserRole.QR_STAFF;

    it("labels an approved QR order 'via QR · <name>' from the joined request", () => {
      const order = mkOrder({ qrRequest: { staffName: 'Sam' } });

      const source = getOrderSource(order);

      expect(source.key).toBe('qr_kitchen');
      expect(source.label).toBe('via QR · Sam');
      expect(source.tone).toBe('rose');
    });

    it('wins over the role fallback, whoever the stored submitter is', () => {
      const order = mkOrder({
        qrRequest: { staffName: 'Sam' },
        submittedBy: mkUser({ role: UserRole.ADMIN }),
      });
      expect(getOrderSource(order).key).toBe('qr_kitchen');
    });

    it('wins over walk-in, which is about the venue and not about how the order arrived', () => {
      const order = mkOrder({ qrRequest: { staffName: 'Sam' }, hoReCa: mkHoReCa({ isTemporary: true }) });
      expect(getOrderSource(order).key).toBe('qr_kitchen');
    });

    it('yields to email_inbound, which is checked first', () => {
      const order = mkOrder({
        inboundMessageId: '11111111-1111-1111-1111-111111111111',
        qrRequest: { staffName: 'Sam' },
      });
      expect(getOrderSource(order).key).toBe('email_inbound');
    });

    it('trims the name and never leaves a dangling separator', () => {
      expect(getOrderSource(mkOrder({ qrRequest: { staffName: '  Sam  ' } })).label).toBe('via QR · Sam');
      expect(getOrderSource(mkOrder({ qrRequest: { staffName: '' } })).label).toBe('via QR');
      expect(getOrderSource(mkOrder({ qrRequest: { staffName: '   ' } })).label).toBe('via QR');
    });

    it('is still a QR order when RLS hid the join but the submitter is a QR Staff login', () => {
      // A viewer outside Admin/Manager/assigned-rep/venue cannot read
      // qr_order_requests, so the embed is null. They can read the submitter's
      // profile, and "Customer Web" would be wrong.
      const order = mkOrder({ qrRequest: null, submittedBy: mkUser({ role: TOKEN_ROLE, name: 'Sam' }) });
      const source = getOrderSource(order);
      expect(source.key).toBe('qr_kitchen');
      expect(source.label).toBe('via QR · Sam');
    });

    it('an ordinary customer order is unchanged', () => {
      expect(getOrderSource(mkOrder({ qrRequest: null })).key).toBe('customer_web');
      expect(getOrderSource(mkOrder({ qrRequest: undefined })).key).toBe('customer_web');
    });
  });

  describe('existing behavior preserved', () => {
    it("returns 'walk_in' for temporary HoReCas when no inboundMessageId", () => {
      const order = mkOrder({ hoReCa: mkHoReCa({ isTemporary: true }) });
      expect(getOrderSource(order).key).toBe('walk_in');
    });

    it("falls back to submittedBy.role for normal HoReCas", () => {
      const order = mkOrder({ submittedBy: mkUser({ role: UserRole.FIELD_REP }) });
      expect(getOrderSource(order).key).toBe('rep_field');
    });

    it("defaults to customer_web when role is unrecognized", () => {
      // Cast to satisfy the type while testing the default branch.
      const order = mkOrder({
        submittedBy: mkUser({ role: 'Unknown' as unknown as UserRole }),
      });
      expect(getOrderSource(order).key).toBe('customer_web');
    });
  });
});

describe('getInboundApproval', () => {
  it('returns null for a non-inbound order', () => {
    expect(getInboundApproval(mkOrder())).toBeNull();
  });

  it('returns the approver name for a human-approved inbound order', () => {
    const order = mkOrder({
      inboundMessageId: '11111111-1111-1111-1111-111111111111',
      autoApproved: false,
      submittedBy: mkUser({ name: 'Jane Smith', role: UserRole.ADMIN }),
    });
    expect(getInboundApproval(order)).toEqual({ auto: false, name: 'Jane Smith' });
  });

  it('drops the name (mailbox owner) for an auto-approved inbound order', () => {
    const order = mkOrder({
      inboundMessageId: '22222222-2222-2222-2222-222222222222',
      autoApproved: true,
      submittedBy: mkUser({ name: 'Mailbox Owner', role: UserRole.ADMIN }),
    });
    expect(getInboundApproval(order)).toEqual({ auto: true, name: null });
  });

  it('treats a missing autoApproved flag as a human approval', () => {
    const order = mkOrder({
      inboundMessageId: '33333333-3333-3333-3333-333333333333',
      submittedBy: mkUser({ name: 'Sam Operator', role: UserRole.MANAGER }),
    });
    expect(getInboundApproval(order)).toEqual({ auto: false, name: 'Sam Operator' });
  });
});
