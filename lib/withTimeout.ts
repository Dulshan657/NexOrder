// Bound a promise to a wall-clock deadline. Used where an `await` can otherwise
// hang indefinitely — e.g. a supabase-js call whose pre-fetch token step stalls,
// or any request the global fetch ceiling (lib/supabase.ts) can't reach because
// the timeout only wraps `fetch`, not the auth resolution that precedes it.
//
// The underlying promise is NOT cancelled (you can't abort an arbitrary promise);
// this just stops the CALLER waiting on it, so the UI can surface an error + retry
// instead of an endless spinner.

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
}
