import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// An ordinary pick patches its own task and nothing more: a broad refetch after every pick
// re-renders the whole workspace and drops fast taps (see useRecordPick). An imported order
// is the exception. Picking beyond the reservation moves free stock, so what is on offer
// changes: the bin just picked at can come back as an unreserved offer, and a line that
// loses its last task must not read "the system shows none" before the server has answered.
// `refreshTasks` is how the row says "this order is imported".

const recordPick = vi.fn()

vi.mock('@/services/supabase/pickService', () => ({
  getPickQueue: vi.fn(),
  recordPick: (...a: unknown[]) => recordPick(...a),
  generatePickSlip: vi.fn(),
  generateDispatchAdvice: vi.fn(),
}))
vi.mock('@/services/supabase/orderService', () => ({ updateOrderStatus: vi.fn() }))

const { useRecordPick, pickKeys } = await import('@/hooks/queries/usePickQueue')
const { pickTaskKeys } = await import('@/hooks/queries/useOrderPickTasks')

const TASKS = pickTaskKeys.forOrder('o1')
let qc: QueryClient
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: qc }, children)

const tasks = () => qc.getQueryData<Array<{ orderItemId: number; remaining: number }>>(TASKS)!

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  qc.setQueryData(TASKS, [{ orderItemId: 1, locationId: 5, pickedQty: 0, remaining: 3 }])
  qc.setQueryData(pickKeys.queue, [{ orderId: 'o1', lines: [{ orderItemId: 1, picked: 0 }] }])
  recordPick.mockReset()
  recordPick.mockResolvedValue({ line_fully_picked: false, order_fully_picked: false })
})

const PICK = { orderId: 'o1', orderItemId: 1, pickedQty: 3, locationId: 5 }
const refetchedTasks = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey) === JSON.stringify(TASKS))

describe('useRecordPick: refreshTasks', () => {
  it('refetches this order\'s tasks after a pick that asks for it', async () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useRecordPick(), { wrapper })

    await act(async () => { await result.current.mutateAsync({ ...PICK, refreshTasks: true }) })

    expect(refetchedTasks(invalidate)).toHaveLength(1)
  })

  it('keeps the finished task until the refetch lands, and waits for it before answering', async () => {
    // Dropping the task first would leave the line with none for as long as the refetch
    // takes, which is exactly the window in which it would read as "nothing in any bin".
    let seen: number | null = null
    let settled = false
    vi.spyOn(qc, 'invalidateQueries').mockImplementation(async (filters) => {
      if (JSON.stringify((filters as { queryKey: unknown }).queryKey) === JSON.stringify(TASKS)) {
        seen = tasks().length
        await Promise.resolve()
        settled = true
      }
    })
    const { result } = renderHook(() => useRecordPick(), { wrapper })

    await act(async () => { await result.current.mutateAsync({ ...PICK, refreshTasks: true }) })

    expect(seen).toBe(1)
    expect(settled).toBe(true)
  })

  it('does not refetch tasks after an ordinary pick, and drops the finished task at once', async () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useRecordPick(), { wrapper })

    await act(async () => { await result.current.mutateAsync(PICK) })

    expect(refetchedTasks(invalidate)).toHaveLength(0)
    expect(tasks()).toHaveLength(0)
  })

  it('still refreshes the queue when the pick finished the line, refresh or not', async () => {
    recordPick.mockResolvedValue({ line_fully_picked: true, order_fully_picked: false })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useRecordPick(), { wrapper })

    await act(async () => { await result.current.mutateAsync({ ...PICK, refreshTasks: true }) })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: pickKeys.queue })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] })
  })

  it('does not wait on a refetch for a refused pick', async () => {
    recordPick.mockRejectedValue(new Error('wrong bin'))
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useRecordPick(), { wrapper })

    await act(async () => { await result.current.mutateAsync({ ...PICK, refreshTasks: true }).catch(() => {}) })

    // The existing rollback refetches once; success-only refresh logic must not add a second.
    expect(refetchedTasks(invalidate)).toHaveLength(1)
    expect(tasks()).toHaveLength(1)
  })
})
