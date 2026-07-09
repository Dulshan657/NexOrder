import { describe, it, expect } from 'vitest'

import { resolveReceiveDestination } from '../components/inventory/ReceiveStockView'

const wh = (id: number) => ({ id })

describe('resolveReceiveDestination', () => {
  it('returns null when there are no active warehouses', () => {
    expect(resolveReceiveDestination([], 5)).toBeNull()
    expect(resolveReceiveDestination([], undefined)).toBeNull()
  })

  it('prefers the home warehouse when it is active', () => {
    expect(resolveReceiveDestination([wh(1), wh(2), wh(3)], 2)).toBe(2)
  })

  it('does not care whether the home site is bulk or racked (unlike the viewer)', () => {
    // Only ids matter here — any active home site wins regardless of type.
    expect(resolveReceiveDestination([wh(7), wh(8)], 8)).toBe(8)
  })

  it('falls back to the first active warehouse when the home site is not active', () => {
    expect(resolveReceiveDestination([wh(3), wh(4)], 99)).toBe(3)
  })

  it('falls back to the first active warehouse when there is no home site', () => {
    expect(resolveReceiveDestination([wh(3), wh(4)], undefined)).toBe(3)
  })
})
