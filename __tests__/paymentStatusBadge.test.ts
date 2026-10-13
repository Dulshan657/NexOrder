import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  getPaymentDisplayState,
  getPaymentLabel,
} from '../components/PaymentStatusBadge';
import type { Invoice } from '../types';

const baseInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 'INV-TEST',
  orderId: 'ORD-001',
  hoReCaId: 1,
  hoReCaName: 'Test HoReCa',
  amount: 100,
  dueDate: '2030-05-12',
  status: 'pending',
  createdDate: '2030-04-12',
  ...overrides,
});

describe('PaymentStatusBadge helpers', () => {
  // CI runs under en-US and a developer box under en-AU, so a date formatted
  // with the runtime's default locale passed here and failed on the runner
  // (main was red from 2026-10-01). Force a foreign default so a regression to
  // `toLocaleDateString(undefined, ...)` fails on every machine, not just CI.
  const realToLocaleDateString = Date.prototype.toLocaleDateString;
  beforeAll(() => {
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
      this: Date,
      locales?: string | string[],
      options?: Intl.DateTimeFormatOptions,
    ) {
      return realToLocaleDateString.call(this, locales ?? 'en-US', options);
    });
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('getPaymentDisplayState', () => {
    it("returns 'not_invoiced' when no invoice exists", () => {
      expect(getPaymentDisplayState(undefined)).toBe('not_invoiced');
    });

    it('mirrors invoice status for pending / paid / overdue', () => {
      expect(getPaymentDisplayState(baseInvoice({ status: 'pending' }))).toBe('pending');
      expect(getPaymentDisplayState(baseInvoice({ status: 'paid' }))).toBe('paid');
      expect(getPaymentDisplayState(baseInvoice({ status: 'overdue' }))).toBe('overdue');
    });
  });

  describe('getPaymentLabel', () => {
    it("returns 'Not Invoiced' when no invoice exists", () => {
      expect(getPaymentLabel(undefined)).toBe('Not Invoiced');
    });

    it('formats pending with due-date prefix', () => {
      const label = getPaymentLabel(baseInvoice({ status: 'pending', dueDate: '2030-05-12' }));
      expect(label.startsWith('Pending · due ')).toBe(true);
      expect(label).toMatch(/12 May/);
    });

    it('formats paid with paid-date when present', () => {
      const label = getPaymentLabel(
        baseInvoice({ status: 'paid', paidDate: '2030-04-30' }),
      );
      expect(label.startsWith('Paid · ')).toBe(true);
      expect(label).toMatch(/30 Apr/);
    });

    it("falls back to bare 'Paid' when paidDate is missing", () => {
      const label = getPaymentLabel(baseInvoice({ status: 'paid', paidDate: undefined }));
      expect(label).toBe('Paid');
    });

    it('formats overdue with due-date in compact mode (no days-late suffix)', () => {
      const label = getPaymentLabel(
        baseInvoice({ status: 'overdue', dueDate: '2020-01-01' }),
        true,
      );
      expect(label).toBe('Overdue · due 01 Jan');
    });

    it('appends days-late suffix in non-compact overdue mode when due date is in the past', () => {
      const label = getPaymentLabel(
        baseInvoice({ status: 'overdue', dueDate: '2020-01-01' }),
        false,
      );
      expect(label.startsWith('Overdue · due 01 Jan')).toBe(true);
      expect(label).toMatch(/\(\d+d late\)/);
    });
  });
});
