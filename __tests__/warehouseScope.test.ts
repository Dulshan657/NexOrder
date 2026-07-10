import { describe, it, expect } from 'vitest';
import {
  parseScopeToken,
  resolveInitialScope,
  isStaffScopeRole,
  canSelectAll,
  type ResolveScopeArgs,
} from '../lib/warehouseScope';
import { UserRole } from '../types';

describe('parseScopeToken', () => {
  it('parses "all" to the literal', () => {
    expect(parseScopeToken('all')).toBe('all');
  });

  it('parses a digit string to its numeric value', () => {
    expect(parseScopeToken('3')).toBe(3);
    expect(parseScopeToken('42')).toBe(42);
  });

  it('returns null for null/undefined', () => {
    expect(parseScopeToken(null)).toBeNull();
    expect(parseScopeToken(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseScopeToken('')).toBeNull();
  });

  it('treats "0" as invalid — location ids are SERIAL starting at 1', () => {
    expect(parseScopeToken('0')).toBeNull();
  });

  it('returns null for a negative number', () => {
    expect(parseScopeToken('-1')).toBeNull();
  });

  it('returns null for a fractional number', () => {
    expect(parseScopeToken('1.5')).toBeNull();
  });

  it('returns null for a non-numeric, non-"all" string', () => {
    expect(parseScopeToken('abc')).toBeNull();
  });
});

describe('isStaffScopeRole', () => {
  it('is true for Admin, Manager, and Warehouse', () => {
    expect(isStaffScopeRole(UserRole.ADMIN)).toBe(true);
    expect(isStaffScopeRole(UserRole.MANAGER)).toBe(true);
    expect(isStaffScopeRole(UserRole.WAREHOUSE)).toBe(true);
  });

  it('is false for reps and customers', () => {
    expect(isStaffScopeRole(UserRole.FIELD_REP)).toBe(false);
    expect(isStaffScopeRole(UserRole.OFFICE_REP)).toBe(false);
    expect(isStaffScopeRole(UserRole.CUSTOMER)).toBe(false);
  });
});

describe('canSelectAll', () => {
  it('is true only for Admin and Manager', () => {
    expect(canSelectAll(UserRole.ADMIN)).toBe(true);
    expect(canSelectAll(UserRole.MANAGER)).toBe(true);
  });

  it('is false for Warehouse and everyone else', () => {
    expect(canSelectAll(UserRole.WAREHOUSE)).toBe(false);
    expect(canSelectAll(UserRole.FIELD_REP)).toBe(false);
    expect(canSelectAll(UserRole.OFFICE_REP)).toBe(false);
    expect(canSelectAll(UserRole.CUSTOMER)).toBe(false);
  });
});

describe('resolveInitialScope — Warehouse role (hard-pinned)', () => {
  const base: ResolveScopeArgs = {
    role: UserRole.WAREHOUSE,
    homeWarehouseId: undefined,
    urlToken: null,
    storedToken: null,
    activeWarehouseIds: [],
  };

  it('pins to the home warehouse when it is active', () => {
    expect(
      resolveInitialScope({ ...base, homeWarehouseId: 2, activeWarehouseIds: [1, 2, 3] }),
    ).toBe(2);
  });

  it('falls back to the first active warehouse when home is missing', () => {
    expect(
      resolveInitialScope({ ...base, homeWarehouseId: undefined, activeWarehouseIds: [5, 6] }),
    ).toBe(5);
  });

  it('falls back to the first active warehouse when home is not active', () => {
    expect(
      resolveInitialScope({ ...base, homeWarehouseId: 99, activeWarehouseIds: [1, 2] }),
    ).toBe(1);
  });

  it('ignores urlToken and storedToken entirely', () => {
    expect(
      resolveInitialScope({
        ...base,
        homeWarehouseId: 1,
        activeWarehouseIds: [1, 2],
        urlToken: '2',
        storedToken: 'all',
      }),
    ).toBe(1);
  });

  it('degenerate case: no active warehouses at all falls back to home id', () => {
    expect(
      resolveInitialScope({ ...base, homeWarehouseId: 7, activeWarehouseIds: [] }),
    ).toBe(7);
  });

  it('degenerate case: no active warehouses and no home falls back to \'all\'', () => {
    expect(
      resolveInitialScope({ ...base, homeWarehouseId: undefined, activeWarehouseIds: [] }),
    ).toBe('all');
  });

  it('never returns \'all\' when at least one active warehouse exists, even without a home', () => {
    const result = resolveInitialScope({
      ...base,
      homeWarehouseId: undefined,
      activeWarehouseIds: [10],
    });
    expect(result).not.toBe('all');
    expect(result).toBe(10);
  });
});

describe('resolveInitialScope — Admin/Manager (urlToken -> storedToken -> \'all\')', () => {
  const base: ResolveScopeArgs = {
    role: UserRole.ADMIN,
    homeWarehouseId: undefined,
    urlToken: null,
    storedToken: null,
    activeWarehouseIds: [1, 2, 3],
  };

  it('honours a valid urlToken over storedToken', () => {
    expect(resolveInitialScope({ ...base, urlToken: '2', storedToken: '3' })).toBe(2);
  });

  it('an urlToken of "all" wins immediately', () => {
    expect(resolveInitialScope({ ...base, urlToken: 'all', storedToken: '3' })).toBe('all');
  });

  it('falls through to storedToken when urlToken is not an active warehouse', () => {
    expect(resolveInitialScope({ ...base, urlToken: '99', storedToken: '3' })).toBe(3);
  });

  it('falls through to storedToken when urlToken is malformed', () => {
    expect(resolveInitialScope({ ...base, urlToken: 'abc', storedToken: '1' })).toBe(1);
  });

  it('falls back to \'all\' when both tokens are absent', () => {
    expect(resolveInitialScope({ ...base, urlToken: null, storedToken: null })).toBe('all');
  });

  it('falls back to \'all\' when both tokens are invalid/inactive', () => {
    expect(resolveInitialScope({ ...base, urlToken: '99', storedToken: '100' })).toBe('all');
  });

  it('a storedToken of "all" is honoured when urlToken is absent', () => {
    expect(resolveInitialScope({ ...base, urlToken: null, storedToken: 'all' })).toBe('all');
  });

  it('accepts a numeric urlToken provisionally when activeWarehouseIds is still empty (async load)', () => {
    expect(
      resolveInitialScope({ ...base, activeWarehouseIds: [], urlToken: '3', storedToken: null }),
    ).toBe(3);
  });

  it('accepts a numeric storedToken provisionally when activeWarehouseIds is still empty', () => {
    expect(
      resolveInitialScope({ ...base, activeWarehouseIds: [], urlToken: null, storedToken: '4' }),
    ).toBe(4);
  });

  it('Manager behaves identically to Admin', () => {
    expect(
      resolveInitialScope({ ...base, role: UserRole.MANAGER, urlToken: '1', storedToken: null }),
    ).toBe(1);
  });
});

describe('resolveInitialScope — everyone else always gets \'all\'', () => {
  const roles = [UserRole.FIELD_REP, UserRole.OFFICE_REP, UserRole.CUSTOMER];

  it.each(roles)('%s ignores tokens and active warehouses, always \'all\'', (role) => {
    expect(
      resolveInitialScope({
        role,
        homeWarehouseId: 1,
        urlToken: '2',
        storedToken: '3',
        activeWarehouseIds: [1, 2, 3],
      }),
    ).toBe('all');
  });
});
