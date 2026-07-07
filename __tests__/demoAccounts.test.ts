import { describe, it, expect } from 'vitest';
import { DEMO_PERSONAS, getBrandByKey, getDemoPersona } from '../lib/demoAccounts';

describe('getDemoPersona', () => {
  it('matches a demo persona by email', () => {
    expect(getDemoPersona({ email: 'tridon@nexorder.demo' })?.brandKey).toBe('tridon');
    expect(getDemoPersona({ email: 'v2food@nexorder.demo' })?.brandKey).toBe('v2food');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(getDemoPersona({ email: '  V2Food@NexOrder.Demo  ' })?.brandKey).toBe('v2food');
  });

  it('returns null for normal users', () => {
    expect(getDemoPersona({ email: 'admin@nexorder.demo' })).toBeNull();
  });

  it('handles missing / nullish input safely', () => {
    expect(getDemoPersona(null)).toBeNull();
    expect(getDemoPersona(undefined)).toBeNull();
    expect(getDemoPersona({})).toBeNull();
    expect(getDemoPersona({ email: null })).toBeNull();
  });

  it('keeps V2food Shop visible but hides Tridon Shop', () => {
    expect(getDemoPersona({ email: 'v2food@nexorder.demo' })?.hideShop).toBe(false);
    expect(getDemoPersona({ email: 'tridon@nexorder.demo' })?.hideShop).toBe(true);
  });
});

describe('getBrandByKey', () => {
  it('resolves a brand for each known key', () => {
    expect(getBrandByKey('tridon')).toEqual({
      logoSrc: DEMO_PERSONAS.tridon.logoSrc,
      displayName: 'Tridon',
    });
    expect(getBrandByKey('v2food')?.displayName).toBe('V2food');
  });

  it('is case-insensitive', () => {
    expect(getBrandByKey('V2FOOD')?.displayName).toBe('V2food');
  });

  it('returns null for unknown / empty keys', () => {
    expect(getBrandByKey('nope')).toBeNull();
    expect(getBrandByKey('')).toBeNull();
    expect(getBrandByKey(null)).toBeNull();
    expect(getBrandByKey(undefined)).toBeNull();
  });
});
