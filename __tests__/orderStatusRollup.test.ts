import { describe, it, expect } from 'vitest';
import { rollupOrderStatus, type FulfillmentStatus } from '../lib/orderStatusRollup';
import { rollupOrderStatus as rollupShared } from '../supabase/functions/_shared/orderStatusRollup';

describe('rollupOrderStatus', () => {
  it('returns processing when there are no fulfillments yet', () => {
    expect(rollupOrderStatus([])).toBe('processing');
  });

  it('returns the single status when there is one fulfillment', () => {
    expect(rollupOrderStatus(['picked'])).toBe('picked');
  });

  it('returns the least-advanced status across fulfillments (slowest site wins)', () => {
    expect(rollupOrderStatus(['dispatched', 'picking' as unknown as FulfillmentStatus, 'packed'])).toBe(
      'packed',
    );
  });

  it('reports a half-dispatched order by its still-picking site', () => {
    // One DC dispatched, the other still picking -> overall is picked.
    expect(rollupOrderStatus(['dispatched', 'picked'])).toBe('picked');
  });

  it('rolls up to delivered only when every fulfillment is delivered', () => {
    expect(rollupOrderStatus(['delivered', 'delivered'])).toBe('delivered');
    expect(rollupOrderStatus(['delivered', 'dispatched'])).toBe('dispatched');
  });

  it('rolls up to processed when all sites are freshly processed', () => {
    expect(rollupOrderStatus(['processed', 'processed', 'processed'])).toBe('processed');
  });

  it('ignores unknown statuses rather than crashing', () => {
    expect(rollupOrderStatus(['packed', 'bogus' as unknown as FulfillmentStatus])).toBe('packed');
  });
});

describe('lib/_shared orderStatusRollup parity', () => {
  it('matches the server twin across representative inputs', () => {
    const cases: FulfillmentStatus[][] = [
      [],
      ['processed'],
      ['picked', 'packed'],
      ['dispatched', 'picked'],
      ['delivered', 'delivered'],
      ['delivered', 'dispatched'],
    ];
    for (const c of cases) {
      expect(rollupShared(c)).toBe(rollupOrderStatus(c));
    }
  });
});
