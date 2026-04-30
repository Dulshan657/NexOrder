// Client-side error reporter.
//
// Sends uncaught errors to the `log-client-error` Edge Function. Wired up in
// three places:
//   1. <ErrorBoundary> — catches React render/lifecycle errors.
//   2. window.addEventListener('error') — catches synchronous exceptions.
//   3. window.addEventListener('unhandledrejection') — catches unawaited
//      Promise rejections.
//
// Dedup: the same error stack within DEDUP_WINDOW_MS is dropped, so a render
// loop can't flood the table.

import { supabase } from './supabase'

const DEDUP_WINDOW_MS = 60_000
const MAX_QUEUE_SIZE = 50

interface ReportInput {
  message: string
  stack?: string
  componentStack?: string
  metadata?: Record<string, unknown>
}

interface QueuedReport extends ReportInput {
  url: string
  userAgent: string
  occurredAt: number
}

const recentSignatures = new Map<string, number>()
const queue: QueuedReport[] = []
let flushing = false

function makeSignature(input: ReportInput): string {
  return `${input.message}::${input.stack ?? ''}::${input.componentStack ?? ''}`
}

function pruneSignatures(now: number): void {
  for (const [sig, ts] of recentSignatures) {
    if (now - ts > DEDUP_WINDOW_MS) recentSignatures.delete(sig)
  }
}

// Strip query strings — they sometimes carry tokens.
function safeUrl(): string {
  if (typeof window === 'undefined') return ''
  const { origin, pathname } = window.location
  return `${origin}${pathname}`
}

function safeUserAgent(): string {
  if (typeof navigator === 'undefined') return ''
  return navigator.userAgent.slice(0, 1024)
}

async function flushQueue(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    while (queue.length > 0) {
      const report = queue.shift()!
      try {
        await supabase.functions.invoke('log-client-error', {
          body: {
            message: report.message,
            stack: report.stack,
            componentStack: report.componentStack,
            url: report.url,
            userAgent: report.userAgent,
            metadata: report.metadata,
          },
        })
      } catch {
        // If the network is gone, drop the report rather than re-queuing
        // forever. The browser console still has it.
      }
    }
  } finally {
    flushing = false
  }
}

export function reportError(input: ReportInput): void {
  const now = Date.now()
  pruneSignatures(now)

  const signature = makeSignature(input)
  if (recentSignatures.has(signature)) return
  recentSignatures.set(signature, now)

  if (queue.length >= MAX_QUEUE_SIZE) return

  queue.push({
    ...input,
    url: safeUrl(),
    userAgent: safeUserAgent(),
    occurredAt: now,
  })

  void flushQueue()
}

let installed = false

export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', event => {
    const err = event.error
    reportError({
      message: event.message || (err instanceof Error ? err.message : String(err ?? 'Unknown error')),
      stack: err instanceof Error ? err.stack : undefined,
      metadata: { source: 'window.error', filename: event.filename, lineno: event.lineno, colno: event.colno },
    })
  })

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason
    const err = reason instanceof Error ? reason : null
    reportError({
      message: err?.message ?? (typeof reason === 'string' ? reason : 'Unhandled promise rejection'),
      stack: err?.stack,
      metadata: { source: 'unhandledrejection' },
    })
  })
}
