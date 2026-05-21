// Resilience for code-split chunks against the production error:
//   "Failed to fetch dynamically imported module: .../assets/AdminView-<hash>.js"
//
// Why this exists: Vite emits content-hashed chunk filenames. Vercel serves
// only the latest deployment's assets/ at nexorder.vercel.app, so when a new
// build ships the old hashed chunks are removed. A tab still running an older
// bundle then 404s the moment it lazy-loads a chunk by its old hash. The
// rejected dynamic import surfaces through React.lazy and trips the
// ErrorBoundary ("Something went wrong"), which is the failure users hit.
//
// Strategy (defense in depth):
//   1. lazyWithRetry()           — drop-in React.lazy replacement. One in-place
//      retry rides out a transient blip; on a persistent chunk-load error a
//      single guarded full reload pulls a fresh index.html (new hashes) and the
//      user lands where they were headed.
//   2. registerChunkErrorReload() — global `vite:preloadError` listener as a
//      backstop for preload <link> failures and any un-wrapped dynamic import.
//
// The sessionStorage guard means a genuinely broken deploy (chunk still 404s
// after the fresh index.html) can't trap the user in a reload loop — the second
// failure rethrows to the ErrorBoundary instead.

import { lazy } from 'react'

const RELOAD_FLAG = 'nexorder:chunk-reload-attempted'

export interface ChunkRetryEnv {
  /** True if a recovery reload was already attempted in this tab session. */
  hasReloaded: () => boolean
  /** Record that a recovery reload is being attempted. */
  markReloaded: () => void
  /** Clear the recovery marker (called after any successful load). */
  clearReloaded: () => void
  /** Force a full document reload to fetch a fresh index.html + chunk hashes. */
  reload: () => void
}

// Cross-browser wording for a missing/blocked dynamic import chunk:
//   Chrome/Edge: "Failed to fetch dynamically imported module: <url>"
//   Firefox:     "error loading dynamically imported module: <url>"
//   Safari:      "Importing a module script failed."
//   MIME mismatch (404 served as HTML): "Failed to load module script: ..."
const CHUNK_ERROR_PATTERNS: ReadonlyArray<RegExp> = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /failed to load module script/i,
]

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return CHUNK_ERROR_PATTERNS.some(pattern => pattern.test(error.message))
}

/**
 * Loads a dynamic-import factory with resilience against stale chunks.
 * Pure and injectable so the recovery policy can be unit-tested without a DOM.
 */
export async function loadChunkWithRetry<T>(
  factory: () => Promise<T>,
  env: ChunkRetryEnv,
): Promise<T> {
  try {
    const mod = await factory()
    env.clearReloaded()
    return mod
  } catch (firstError) {
    // A genuine error thrown while evaluating the module (a real bug) goes
    // straight to the ErrorBoundary — retrying or reloading would only mask it.
    if (!isChunkLoadError(firstError)) throw firstError

    // Transient network blip: one in-place retry before the heavier reload.
    try {
      const mod = await factory()
      env.clearReloaded()
      return mod
    } catch (retryError) {
      if (isChunkLoadError(retryError) && !env.hasReloaded()) {
        env.markReloaded()
        env.reload()
        // The reload replaces this document. Never settle, so React keeps the
        // Suspense fallback up for the brief moment until navigation happens.
        return new Promise<T>(() => {})
      }
      throw retryError
    }
  }
}

const browserEnv: ChunkRetryEnv = {
  hasReloaded: () => {
    try {
      return window.sessionStorage.getItem(RELOAD_FLAG) === '1'
    } catch {
      return false
    }
  },
  markReloaded: () => {
    try {
      window.sessionStorage.setItem(RELOAD_FLAG, '1')
    } catch {
      // sessionStorage can throw in private mode / sandboxed iframes — best effort.
    }
  },
  clearReloaded: () => {
    try {
      window.sessionStorage.removeItem(RELOAD_FLAG)
    } catch {
      // best effort
    }
  },
  reload: () => window.location.reload(),
}

/**
 * Drop-in replacement for React.lazy that recovers from stale-chunk failures
 * after a redeploy. Use it exactly like lazy():
 *   const AdminView = lazyWithRetry(() => import('./AdminView'))
 */
export function lazyWithRetry<T>(factory: () => Promise<{ default: T }>) {
  return lazy(() => loadChunkWithRetry(factory, browserEnv))
}

/**
 * Backstop: Vite dispatches `vite:preloadError` on window when its preload
 * helper fails to load a chunk (including the modulepreload <link>s that fire
 * before React even tries the import). One guarded reload here covers paths the
 * lazyWithRetry wrapper can't see. Register once at app startup.
 */
export function registerChunkErrorReload(env: ChunkRetryEnv = browserEnv): void {
  if (typeof window === 'undefined') return
  window.addEventListener('vite:preloadError', () => {
    if (env.hasReloaded()) return
    env.markReloaded()
    env.reload()
  })
}
