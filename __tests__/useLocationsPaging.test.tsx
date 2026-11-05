import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// The one caller of getLocations. Every screen that resolves a scanned bin code reads
// it, so what it hands them has to include the rows past the API's 1000-row cap
// (see inventoryService.locations.test.ts). Every row is made up.

const ROWS = vi.hoisted(() =>
  Array.from({ length: 1500 }, (_, i) => ({
    id: i + 1,
    parent_id: null,
    kind: 'BIN',
    code: `TST-B-${i + 1}`,
    name: `Bin ${i + 1}`,
    materialized_path: `1/${i + 1}`,
    is_active: true,
  })),
)

vi.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {}
  q.select = () => q
  q.order = () => q
  q.range = (from: number, to: number) => Promise.resolve({ data: ROWS.slice(from, to + 1), error: null })
  // An unranged read is answered the way the API answers it: the first 1000 rows, no warning.
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: ROWS.slice(0, 1000), error: null }).then(ok)
  return { supabase: { from: () => q } }
})

const { useLocations } = await import('../hooks/queries/useInventoryBalances')

describe('useLocations (the one caller of getLocations)', () => {
  it('hands its callers every location, including one past the first 1000', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children)

    const { result } = renderHook(() => useLocations(), { wrapper })

    await waitFor(() => expect(result.current.data).toBeTruthy())
    const data = result.current.data!
    expect(data).toHaveLength(1500)
    // The adapter ran on every row: the scan index reads `code`, `name` and `isActive`.
    expect(data.find((l) => l.code === 'TST-B-1400')).toMatchObject({ id: 1400, isActive: true })
  })
})
