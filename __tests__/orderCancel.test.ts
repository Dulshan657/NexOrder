import { describe, it, expect } from 'vitest';
import {
  cancelBlocker,
  evaluateCancel,
  CANCELLABLE_STATUSES,
  CANCEL_REASON_MIN,
  CANCEL_REASON_MAX,
  type CancelSubject,
  type CancellableOrderStatus,
} from '../supabase/functions/_shared/orderCancel';
import { cancelBlocker as cancelBlockerClient } from '../lib/orderCancel';

const ALL_STATUSES: CancellableOrderStatus[] = [
  'processing',
  'processed',
  'picked',
  'packed',
  'dispatched',
  'delivered',
  'cancelled',
];

const REASON = 'Customer phoned to cancel';

type CancelInput = CancelSubject & { reason?: string | null };

function subject(over: Partial<CancelInput> = {}): CancelInput {
  return {
    status: 'processing',
    invoiceStatus: 'pending',
    pickedUnits: 0,
    actorRole: 'Admin',
    ...over,
  };
}

describe('cancelBlocker — who and when', () => {
  it('allows an Admin to cancel from the two pre-pick statuses', () => {
    for (const status of CANCELLABLE_STATUSES) {
      expect(cancelBlocker(subject({ status }))).toBeNull();
    }
  });

  it('refuses every status past the pick line, naming what happened instead', () => {
    for (const status of ALL_STATUSES) {
      if (CANCELLABLE_STATUSES.includes(status) || status === 'cancelled') continue;
      const blocker = cancelBlocker(subject({ status }));
      expect(blocker?.code).toBe('NOT_CANCELLABLE');
      // The message has to say which status, or the operator cannot tell a
      // dispatched order from a picked one and does not know what to do next.
      expect(blocker?.message).toContain(status === 'picked' ? 'picked' : status);
    }
  });

  it('reports an already-cancelled order distinctly from an uncancellable one', () => {
    // A double submit must read as "already done", not as "you may not do this",
    // and the server relies on the distinction to avoid releasing twice.
    expect(cancelBlocker(subject({ status: 'cancelled' }))?.code).toBe('ALREADY_CANCELLED');
  });

  it('refuses every role except Admin, including Manager', () => {
    for (const role of ['Manager', 'Warehouse', 'Field Sales Rep', 'Office Sales Rep', 'Restaurant/Hotel Customer', '']) {
      expect(cancelBlocker(subject({ actorRole: role }))?.code).toBe('FORBIDDEN');
    }
  });

  it('checks the role before anything else, so a customer is never told about the invoice', () => {
    const blocker = cancelBlocker(
      subject({ actorRole: 'Restaurant/Hotel Customer', status: 'delivered', invoiceStatus: 'paid' }),
    );
    expect(blocker?.code).toBe('FORBIDDEN');
  });
});

describe('cancelBlocker — picking has started', () => {
  it('refuses an order that reads as processed but has picked units', () => {
    // The case the status alone cannot see: order status is the rollup of its
    // per-warehouse fulfilments and takes the LOWEST rung, so one site can have
    // picked while the order still reads `processed`.
    const blocker = cancelBlocker(subject({ status: 'processed', pickedUnits: 3 }));
    expect(blocker?.code).toBe('PICKING_STARTED');
    expect(blocker?.message).toContain('3 units');
  });

  it('says "1 unit has" rather than "1 units have"', () => {
    expect(cancelBlocker(subject({ pickedUnits: 1 }))?.message).toContain('1 unit has');
  });

  it('allows a cancel when nothing has been picked', () => {
    expect(cancelBlocker(subject({ pickedUnits: 0 }))).toBeNull();
  });

  it('reports the status before the picks — a dispatched order is past cancelling either way', () => {
    expect(cancelBlocker(subject({ status: 'dispatched', pickedUnits: 5 }))?.code).toBe(
      'NOT_CANCELLABLE',
    );
  });
});

describe('cancelBlocker — the invoice', () => {
  it('refuses when the invoice has been paid', () => {
    const blocker = cancelBlocker(subject({ invoiceStatus: 'paid' }));
    expect(blocker?.code).toBe('INVOICE_PAID');
    expect(blocker?.message).toMatch(/refund|credit/i);
  });

  it('allows pending, overdue, already-cancelled and absent invoices', () => {
    for (const invoiceStatus of ['pending', 'overdue', 'cancelled', null] as const) {
      expect(cancelBlocker(subject({ invoiceStatus }))).toBeNull();
    }
  });

  it('allows an order with no invoice at all', () => {
    // place-order creates the invoice best-effort and only warns if it fails, so
    // an invoice-less order is a real state and not a defensive nicety.
    expect(cancelBlocker(subject({ invoiceStatus: null }))).toBeNull();
  });
});

describe('evaluateCancel — the reason', () => {
  it('accepts a reason at the floor and at the ceiling', () => {
    expect(evaluateCancel(subject({ reason: 'x'.repeat(CANCEL_REASON_MIN) })).ok).toBe(true);
    expect(evaluateCancel(subject({ reason: 'x'.repeat(CANCEL_REASON_MAX) })).ok).toBe(true);
  });

  it('refuses a missing, blank, whitespace-only or too-short reason', () => {
    for (const reason of [undefined, null, '', '   ', 'x'.repeat(CANCEL_REASON_MIN - 1)]) {
      const verdict = evaluateCancel(subject({ reason }));
      expect(verdict.ok).toBe(false);
      if (verdict.ok === false) expect(verdict.code).toBe('REASON_REQUIRED');
    }
  });

  it('refuses a reason past the ceiling', () => {
    const verdict = evaluateCancel(subject({ reason: 'x'.repeat(CANCEL_REASON_MAX + 1) }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok === false) expect(verdict.code).toBe('REASON_REQUIRED');
  });

  it('trims before measuring, so padding cannot pass for a reason', () => {
    const padded = ' '.repeat(50) + 'ab' + ' '.repeat(50);
    const verdict = evaluateCancel(subject({ reason: padded }));
    expect(verdict.ok).toBe(false);
  });

  it('reports the blocker ahead of the reason', () => {
    // Otherwise an operator types a reason for a dispatched order, submits, and
    // only then learns it was never cancellable.
    const verdict = evaluateCancel(subject({ status: 'delivered', reason: '' }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok === false) expect(verdict.code).toBe('NOT_CANCELLABLE');
  });

  it('accepts a well-formed cancellation', () => {
    expect(evaluateCancel(subject({ reason: REASON })).ok).toBe(true);
  });
});

describe('the browser and the server share one implementation', () => {
  it('lib/orderCancel re-exports the same function, not a copy', () => {
    // If these ever diverge, the button offers an action the server refuses (or
    // greys out one it would have allowed). Identity is the only check that
    // catches a fork before it ships.
    expect(cancelBlockerClient).toBe(cancelBlocker);
  });

  it('cancelled is not one of the cancellable statuses', () => {
    expect(CANCELLABLE_STATUSES).not.toContain('cancelled');
  });

  it('the cancellable set is exactly the two pre-pick statuses', () => {
    // Widening this is a business decision, not a refactor: anything past
    // `processed` has stock off the shelf that inv_release_reservation cannot
    // put back. Pinned so it cannot grow by accident.
    expect([...CANCELLABLE_STATUSES]).toEqual(['processing', 'processed']);
  });
});
