import { describe, it, expect } from 'vitest';
import { getOrderSource } from '../lib/orderSource';
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
