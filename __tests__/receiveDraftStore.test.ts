// An unfinished goods receipt survives leaving the screen (NX-0005 A13).
//
// Browser storage, because a draft is a per-viewer convenience: it is never
// shared, never read back by the server, and losing it costs a re-scan rather
// than data. Every access is wrapped, because storage can be absent or throw
// (private windows, blocked site data, a full quota) and the receive screen
// must work regardless.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DRAFT_TTL_MS,
  clearReceiveDraft,
  loadReceiveDraft,
  saveReceiveDraft,
  type ReceiveDraftSnapshot,
} from '@/components/inventory/receive/receiveDraftStore'

/** A minimal in-memory Storage — the node project has no window. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k) },
    setItem: (k, v) => { map.set(k, String(v)) },
  }
}

function snapshot(overrides: Partial<ReceiveDraftSnapshot> = {}): ReceiveDraftSnapshot {
  return {
    supplierId: 1,
    supplierName: 'Acme Foods',
    reference: 'INV-77',
    receivedDate: '2026-10-27',
    quarantineAll: false,
    destinationId: 1,
    lines: [{
      key: 'dx-0', productId: 5, quantity: '3', uomId: 12, lotCode: '', expiryDate: '',
      barcode: '', plateKey: 'px-0', quarantine: false,
    }],
    plates: [{ key: 'px-0', huType: 'carton' }],
    activeGroupKey: null,
    forceNewPallet: false,
    ...overrides,
  }
}

let storage: Storage
const NOW = Date.UTC(2026, 9, 27, 9, 0, 0)

beforeEach(() => { storage = memoryStorage() })
afterEach(() => { vi.restoreAllMocks() })

describe('receive draft store', () => {
  it('round-trips a draft for the same user', () => {
    saveReceiveDraft(7, snapshot(), storage, NOW)
    const loaded = loadReceiveDraft(7, storage, NOW + 60_000)
    expect(loaded?.draft).toEqual(snapshot())
    expect(loaded?.savedAt).toBe(NOW)
  })

  it("keeps one user's draft away from another", () => {
    // A handheld at a dock is shared between shifts.
    saveReceiveDraft(7, snapshot(), storage, NOW)
    expect(loadReceiveDraft(8, storage, NOW)).toBeNull()
  })

  it('drops a draft older than a day', () => {
    // A receipt forgotten yesterday must not come back as if it were today's truck.
    saveReceiveDraft(7, snapshot(), storage, NOW)
    expect(loadReceiveDraft(7, storage, NOW + DRAFT_TTL_MS + 1)).toBeNull()
    // …and it is removed, not merely ignored.
    expect(storage.length).toBe(0)
  })

  it('does not keep an empty draft — nothing staged and nothing typed', () => {
    saveReceiveDraft(7, snapshot(), storage, NOW)
    saveReceiveDraft(7, snapshot({
      supplierId: null, supplierName: '', reference: '', lines: [], plates: [],
    }), storage, NOW)
    expect(storage.length).toBe(0)
  })

  it('clears on demand', () => {
    saveReceiveDraft(7, snapshot(), storage, NOW)
    clearReceiveDraft(7, storage)
    expect(loadReceiveDraft(7, storage, NOW)).toBeNull()
  })

  it('ignores a corrupt or foreign value instead of crashing', () => {
    storage.setItem('nexorder_v1_receive_draft:7', '{not json')
    expect(loadReceiveDraft(7, storage, NOW)).toBeNull()
    storage.setItem('nexorder_v1_receive_draft:7', JSON.stringify({ v: 99, savedAt: NOW, draft: {} }))
    expect(loadReceiveDraft(7, storage, NOW)).toBeNull()
    storage.setItem('nexorder_v1_receive_draft:7', JSON.stringify({ v: 1, savedAt: NOW, draft: { lines: 'x' } }))
    expect(loadReceiveDraft(7, storage, NOW)).toBeNull()
  })

  it('survives storage that throws', () => {
    const broken = {
      ...memoryStorage(),
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('QuotaExceededError') },
      removeItem: () => { throw new Error('SecurityError') },
    } as Storage
    expect(() => saveReceiveDraft(7, snapshot(), broken, NOW)).not.toThrow()
    expect(loadReceiveDraft(7, broken, NOW)).toBeNull()
    expect(() => clearReceiveDraft(7, broken)).not.toThrow()
  })

  it('does nothing without a user to key it by', () => {
    saveReceiveDraft(undefined, snapshot(), storage, NOW)
    expect(storage.length).toBe(0)
    expect(loadReceiveDraft(undefined, storage, NOW)).toBeNull()
  })
})
