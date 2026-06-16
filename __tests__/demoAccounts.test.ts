import { describe, it, expect } from 'vitest';
import { TRIDON_DEMO_EMAIL, isTridonDemoUser } from '../lib/demoAccounts';

describe('isTridonDemoUser', () => {
  it('matches the Tridon demo email', () => {
    expect(isTridonDemoUser({ email: TRIDON_DEMO_EMAIL })).toBe(true);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(isTridonDemoUser({ email: '  Tridon@NexOrder.Demo  ' })).toBe(true);
  });

  it('rejects other users', () => {
    expect(isTridonDemoUser({ email: 'admin@nexorder.demo' })).toBe(false);
  });

  it('handles missing / nullish input safely', () => {
    expect(isTridonDemoUser(null)).toBe(false);
    expect(isTridonDemoUser(undefined)).toBe(false);
    expect(isTridonDemoUser({})).toBe(false);
    expect(isTridonDemoUser({ email: null })).toBe(false);
  });
});
