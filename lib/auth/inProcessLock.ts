/**
 * In-process replacement for supabase-js's default `navigatorLock`.
 *
 * supabase-js v2 serialises auth operations behind a lock whenever
 * `persistSession` is on, and in a browser it reaches for the Web Locks API
 * (`navigator.locks`). That acquisition never resolved in our environment: the
 * AuthProvider's `getSession()` hung during `_initialize()` and the AuthGate
 * spinner stayed up forever. Persistence was switched off for a long time to
 * dodge it, which cost every user their session on each refresh and — with
 * `autoRefreshToken` off alongside it — roughly hourly thereafter.
 *
 * This is the smaller fix: keep persistence, drop the Web Locks dependency.
 * Callers of the same lock name queue on a promise chain within this tab.
 *
 * What is given up is cross-TAB serialisation. Two tabs can refresh the same
 * session concurrently; refresh tokens rotate, so the loser retries with the
 * new one. That is an acceptable trade for removing a hang, and it is the same
 * guarantee supabase-js falls back to in any non-browser runtime.
 *
 * Kept in its own module — free of the Supabase client and its required env
 * vars — so the queueing behaviour can be tested directly.
 */

/** Matches supabase-js's `LockFunc`. */
export type LockFunc = <R>(name: string, acquireTimeout: number, fn: () => Promise<R>) => Promise<R>

const chains = new Map<string, Promise<unknown>>()

/**
 * `acquireTimeout` is deliberately ignored: the only contention is this tab's
 * own queue, and a timeout is precisely the failure mode being removed.
 */
export const inProcessLock: LockFunc = (name, _acquireTimeout, fn) => {
    const previous = chains.get(name) ?? Promise.resolve()
    // Swallow the predecessor's rejection so one failed operation cannot poison
    // every later acquisition of the same lock — but hand the caller the real
    // promise, so their own failure still surfaces to them.
    const run = previous.catch(() => undefined).then(fn)
    chains.set(name, run.catch(() => undefined))
    return run
}

/** Test seam: forget every queue. Never needed in the app. */
export function resetInProcessLocks(): void {
    chains.clear()
}
