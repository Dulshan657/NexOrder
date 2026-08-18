// Who, if anyone, is currently listening for a stray scan.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// `useWedgeScanner` is opt-in, and only three surfaces opt in: Receive Stock,
// the stocktake location finder, and the putaway scan finder. Everywhere else —
// the dashboard, the pick queue, a settings tab, an open modal — a scan fired
// with nothing focused produces characters that go to the body and vanish.
//
// That silence is the exact failure `useWedgeScanner` was written to end, and it
// ends it on three screens out of forty. `playScanStray` was written for the
// remaining thirty-seven and was never wired to anything: the tones, the
// vibration pattern and its tests all shipped, and it has never once sounded.
//
// So there is a fallback listener mounted once, app-wide, whose entire job is to
// say "that went nowhere". It must stand down whenever a real surface is
// listening, or a scan on Receive Stock would be handled twice — once usefully,
// once as a complaint. This module is how the two find out about each other.
//
// ── WHY A MODULE-LEVEL STORE AND NOT A CONTEXT ──────────────────────────────
//
// The fallback needs to answer "is anyone else listening?" SYNCHRONOUSLY, from
// inside a keydown handler, at the instant a code commits. A context value is a
// render-time snapshot; it can be one render stale, and one render is the whole
// window in which a double-handle happens. `hasActiveWedgeConsumer()` reads the
// live count with no React in the path.
//
// `useHasWedgeConsumer()` exists alongside it so the fallback can also *unmount*
// its listener when a surface claims capture, rather than merely swallowing
// events. Both are needed: the subscription keeps the common case cheap, the
// synchronous read closes the frame-boundary hole the subscription cannot.

const listeners = new Set<() => void>()

let consumers = 0

/**
 * Claim wedge capture for a surface. Returns the release.
 *
 * Idempotence is the CALLER's affair by construction: the returned function
 * releases exactly the claim it was issued for, and releasing twice is a no-op,
 * so a React effect cleanup running twice under StrictMode cannot drive the
 * count negative.
 */
export function registerWedgeConsumer(): () => void {
  consumers += 1
  notify()

  let released = false
  return () => {
    if (released) return
    released = true
    consumers -= 1
    notify()
  }
}

/**
 * Is a real scanning surface listening right now?
 *
 * Synchronous and React-free on purpose — see the header. This is the check the
 * fallback makes at commit time, after its own listener has already fired.
 */
export function hasActiveWedgeConsumer(): boolean {
  return consumers > 0
}

/** Test seam, and the reason `consumers` is not exported directly. */
export function activeWedgeConsumerCount(): number {
  return consumers
}

/** Test seam: forget every claim. Never needed in the app. */
export function resetWedgeConsumers(): void {
  consumers = 0
  listeners.clear()
}

export function subscribeWedgeConsumers(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  // Copied before iterating: a listener that unsubscribes itself in response
  // would otherwise mutate the set mid-loop.
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // A broken subscriber must not stop the others being told, and must
      // never propagate into the effect that changed the count.
    }
  }
}
