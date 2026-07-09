import { describe, it, expect } from 'vitest';

import { resolveReceiveDestination } from '../supabase/functions/_shared/receiveDestination';
import { EdgeFunctionError, isEdgeFunctionError } from '../supabase/functions/_shared/errors';

const warehouseActor = (homeWarehouseId: number | null) => ({ role: 'Warehouse', homeWarehouseId });
const adminActor = { role: 'Admin', homeWarehouseId: null };

describe('resolveReceiveDestination (receive-stock guard)', () => {
  it('Warehouse role + NULL home + explicit location_id succeeds (no FORBIDDEN)', () => {
    expect(resolveReceiveDestination(9, warehouseActor(null), 2)).toBe(9);
  });

  it('Warehouse role + home=5 + location_id=9 throws FORBIDDEN', () => {
    expect.assertions(3);
    try {
      resolveReceiveDestination(9, warehouseActor(5), 2);
    } catch (err) {
      expect(isEdgeFunctionError(err)).toBe(true);
      expect((err as EdgeFunctionError).code).toBe('FORBIDDEN');
      expect((err as EdgeFunctionError).status).toBe(403);
    }
  });

  it('Warehouse role + home=5 + location_id=5 succeeds', () => {
    expect(resolveReceiveDestination(5, warehouseActor(5), 2)).toBe(5);
  });

  it('Warehouse role + home=5 + no explicit location_id resolves to home', () => {
    expect(resolveReceiveDestination(undefined, warehouseActor(5), 2)).toBe(5);
  });

  it('any role + null destination + 2 active warehouses throws INVALID_INPUT', () => {
    expect.assertions(2);
    try {
      resolveReceiveDestination(undefined, adminActor, 2);
    } catch (err) {
      expect(isEdgeFunctionError(err)).toBe(true);
      expect((err as EdgeFunctionError).code).toBe('INVALID_INPUT');
    }
  });

  it('any role + null destination + 1 active warehouse proceeds to the RPC (returns null)', () => {
    expect(resolveReceiveDestination(undefined, adminActor, 1)).toBeNull();
  });

  it('any role + null destination + 0 active warehouses also proceeds (RPC surfaces NO_WAREHOUSE)', () => {
    expect(resolveReceiveDestination(null, adminActor, 0)).toBeNull();
  });

  it('Admin with an explicit location_id is never subject to the Warehouse-only FORBIDDEN guard', () => {
    expect(resolveReceiveDestination(42, adminActor, 2)).toBe(42);
  });
});
