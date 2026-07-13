import { describe, it, expect, vi, afterEach } from 'vitest'
import { withTimeout } from '@/lib/withTimeout'

afterEach(() => {
  vi.useRealTimers()
})

describe('withTimeout', () => {
  it('passes through the resolved value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'too slow')).resolves.toBe(42)
  })

  it('passes through a rejection from the wrapped promise (not the timeout message)', async () => {
    const boom = new Error('original failure')
    await expect(withTimeout(Promise.reject(boom), 1000, 'too slow')).rejects.toBe(boom)
  })

  it('rejects with the given message once the deadline elapses', async () => {
    vi.useFakeTimers()
    const never = new Promise<string>(() => {}) // never settles
    const raced = withTimeout(never, 25_000, 'Uploading timed out')
    const assertion = expect(raced).rejects.toThrow('Uploading timed out')
    await vi.advanceTimersByTimeAsync(25_000)
    await assertion
  })

  it('does not reject if the promise resolves before the deadline', async () => {
    vi.useFakeTimers()
    const raced = withTimeout(Promise.resolve('ok'), 25_000, 'should not fire')
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(raced).resolves.toBe('ok')
  })
})
