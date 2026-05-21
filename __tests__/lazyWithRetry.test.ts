import { describe, it, expect, vi } from 'vitest'

import {
  isChunkLoadError,
  loadChunkWithRetry,
  type ChunkRetryEnv,
} from '../lib/lazyWithRetry'

// The exact message a tab on a stale deploy throws when a content-hashed chunk
// 404s after a redeploy replaced assets/ (the production error we're fixing).
const chunkError = new TypeError(
  'Failed to fetch dynamically imported module: https://nexorder.vercel.app/assets/AdminView-1ESDEzy4.js',
)

function makeEnv(opts: { reloaded?: boolean } = {}): ChunkRetryEnv {
  let reloaded = opts.reloaded ?? false
  return {
    hasReloaded: vi.fn(() => reloaded),
    markReloaded: vi.fn(() => {
      reloaded = true
    }),
    clearReloaded: vi.fn(() => {
      reloaded = false
    }),
    reload: vi.fn(),
  }
}

// Resolves to 'pending' if the promise hasn't settled within a macrotask —
// used to assert the never-settling "page is reloading" branch.
function settleState<T>(p: Promise<T>): Promise<'resolved' | 'rejected' | 'pending'> {
  return Promise.race([
    p.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    ),
    new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 10)),
  ])
}

describe('isChunkLoadError', () => {
  it('detects the Chrome/Edge stale-chunk message', () => {
    expect(isChunkLoadError(chunkError)).toBe(true)
  })

  it('detects Firefox, Safari, and MIME-mismatch wordings', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module: https://x/y.js'))).toBe(true)
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Failed to load module script: Expected a JavaScript module'))).toBe(true)
  })

  it('ignores ordinary runtime errors and non-Error values', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('loadChunkWithRetry', () => {
  it('resolves and clears the reload flag on first success', async () => {
    const mod = { default: 'AdminView' }
    const factory = vi.fn().mockResolvedValue(mod)
    const env = makeEnv()

    await expect(loadChunkWithRetry(factory, env)).resolves.toBe(mod)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(env.clearReloaded).toHaveBeenCalledTimes(1)
    expect(env.reload).not.toHaveBeenCalled()
  })

  it('retries once in place and resolves after a transient chunk failure', async () => {
    const mod = { default: 'AdminView' }
    const factory = vi
      .fn()
      .mockRejectedValueOnce(chunkError)
      .mockResolvedValueOnce(mod)
    const env = makeEnv()

    await expect(loadChunkWithRetry(factory, env)).resolves.toBe(mod)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(env.reload).not.toHaveBeenCalled()
    expect(env.clearReloaded).toHaveBeenCalled()
  })

  it('reloads once and stays pending on a persistent chunk failure (not yet reloaded)', async () => {
    const factory = vi.fn().mockRejectedValue(chunkError)
    const env = makeEnv({ reloaded: false })

    const result = settleState(loadChunkWithRetry(factory, env))
    await expect(result).resolves.toBe('pending')
    expect(factory).toHaveBeenCalledTimes(2)
    expect(env.markReloaded).toHaveBeenCalledTimes(1)
    expect(env.reload).toHaveBeenCalledTimes(1)
  })

  it('rethrows instead of looping when a reload was already attempted', async () => {
    const factory = vi.fn().mockRejectedValue(chunkError)
    const env = makeEnv({ reloaded: true })

    await expect(loadChunkWithRetry(factory, env)).rejects.toBe(chunkError)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(env.reload).not.toHaveBeenCalled()
  })

  it('rethrows a genuine module error immediately, without retry or reload', async () => {
    const realError = new Error('boom while evaluating module top-level')
    const factory = vi.fn().mockRejectedValue(realError)
    const env = makeEnv()

    await expect(loadChunkWithRetry(factory, env)).rejects.toBe(realError)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(env.reload).not.toHaveBeenCalled()
  })
})
