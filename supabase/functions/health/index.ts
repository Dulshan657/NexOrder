// health Edge Function
//
// Continuous deployment-monitoring probe. Two tiers of access:
//
//   GET  (unauthenticated)      — minimal liveness probe: timed DB ping only.
//                                 Rate-limited 10/min/IP. NO DB writes, so it
//                                 cannot be abused to flood health_checks.
//   POST (Bearer HEALTH_CRON_TOKEN, constant-time compared) — the full check,
//                                 invoked by pg_cron every 5 minutes:
//                                   1. timed DB ping
//                                   2. GET {APP_URL}/version.json (5s timeout)
//                                   3. count client_errors in the last 10 min
//                                   4. deriveStatus + insert health_checks row
//                                   5. on status TRANSITION: broadcast Admin
//                                      bell notification + fire-and-forget
//                                      system_alert email via send-email
//
// verify_jwt = false (config.toml): pg_cron cannot send a Supabase JWT; the
// cron token is the auth. The GET tier is deliberately unauthenticated so an
// external uptime checker can use it.
//
// Environment:
//   HEALTH_CRON_TOKEN — shared secret for the POST tier
//   APP_URL           — frontend origin (default https://nexorder.vercel.app)

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import { corsHeadersFor } from '../_shared/cors.ts'
import { checkRateLimit, clientIp } from '../_shared/rateLimit.ts'
import { isAuthorizedCronCall } from '../_shared/cronToken.ts'
import {
  deriveStatus,
  shouldAlert,
  alertMessage,
  type HealthStatus,
} from '../_shared/healthLogic.ts'

const DEFAULT_APP_URL = 'https://nexorder.vercel.app'
const VERSION_FETCH_TIMEOUT_MS = 5_000
const ERROR_WINDOW_MS = 10 * 60_000

function jsonResponse(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
}

/** Timed lightweight DB ping against the app_settings singleton. */
async function pingDb(admin: ReturnType<typeof adminClient>): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  const started = Date.now()
  try {
    const { error } = await admin
      .from('app_settings')
      .select('id', { count: 'exact', head: true })
    const latencyMs = Date.now() - started
    if (error) return { ok: false, latencyMs, error: error.message }
    return { ok: true, latencyMs, error: null }
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // ── Tier 1: unauthenticated GET — minimal probe, no writes ────────────────
  if (req.method === 'GET') {
    const ip = clientIp(req)
    const rl = await checkRateLimit(`health:get:${ip}`, { windowMs: 60_000, max: 10 })
    if (!rl.ok) {
      return jsonResponse({ error: { code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded' } }, 429, corsHeaders)
    }
    const db = await pingDb(adminClient())
    return jsonResponse(
      { ok: db.ok, db: { ok: db.ok, latencyMs: db.latencyMs }, timestamp: new Date().toISOString() },
      db.ok ? 200 : 503,
      corsHeaders,
    )
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or POST only' } }, 405, corsHeaders)
  }

  // ── Tier 2: cron POST — full check + record + alert ───────────────────────
  if (!isAuthorizedCronCall(req.headers.get('Authorization'), 'HEALTH_CRON_TOKEN')) {
    return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron token' } }, 401, corsHeaders)
  }

  const admin = adminClient()

  // 1. DB ping
  const db = await pingDb(admin)

  // 2. Frontend probe — /version.json must parse within the timeout.
  const appUrl = Deno.env.get('APP_URL') ?? DEFAULT_APP_URL
  let frontendOk = false
  let frontendVersion: string | null = null
  let frontendError: string | null = null
  try {
    const resp = await fetch(`${appUrl}/version.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(VERSION_FETCH_TIMEOUT_MS),
    })
    if (resp.ok) {
      const json = (await resp.json()) as { sha?: string }
      frontendOk = true
      frontendVersion = typeof json.sha === 'string' ? json.sha : null
    } else {
      frontendError = `version.json HTTP ${resp.status}`
    }
  } catch (e) {
    frontendError = e instanceof Error ? e.message : String(e)
  }

  // 3. Client-error spike count (last 10 minutes). Count failure degrades to 0
  //    rather than failing the whole tick.
  let errorCount = 0
  if (db.ok) {
    const since = new Date(Date.now() - ERROR_WINDOW_MS).toISOString()
    const { count, error: countError } = await admin
      .from('client_errors')
      .select('id', { count: 'exact', head: true })
      .gte('occurred_at', since)
    if (!countError && typeof count === 'number') errorCount = count
  }

  // 4. Derive status, read previous tick, insert this one.
  const status = deriveStatus({ dbOk: db.ok, frontendOk, errorCount })
  const errorSummary = [db.error && `db: ${db.error}`, frontendError && `frontend: ${frontendError}`]
    .filter(Boolean)
    .join('; ') || null

  let previous: HealthStatus | null = null
  const { data: prevRow } = await admin
    .from('health_checks')
    .select('status')
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (prevRow?.status) previous = prevRow.status as HealthStatus

  const { error: insertError } = await admin.from('health_checks').insert({
    status,
    db_latency_ms: db.latencyMs,
    frontend_ok: frontendOk,
    frontend_version: frontendVersion,
    error_count_10m: errorCount,
    error: errorSummary,
    metadata: { appUrl },
  } as any)
  if (insertError) {
    console.error('[health] failed to insert health_checks row:', insertError.message)
  }

  // 5. Alert on transitions only (including recovery).
  let alerted = false
  if (shouldAlert(previous, status)) {
    alerted = true
    const message = alertMessage({
      status,
      previous,
      dbOk: db.ok,
      dbLatencyMs: db.latencyMs,
      frontendOk,
      frontendVersion,
      errorCount,
      error: errorSummary,
    })

    // Admin bell — broadcast row (user_id null + target_roles) so the
    // realtime channel fans it out to every Admin.
    const { error: notifError } = await admin.from('notifications').insert({
      id: `notif-health-${Date.now()}`,
      type: 'system_alert',
      message,
      user_id: null,
      target_roles: ['Admin'],
      metadata: { status, previous, frontendVersion },
    } as any)
    if (notifError) {
      console.error('[health] failed to insert alert notification:', notifError.message)
    }

    // Fire-and-forget email (pattern: place-order). Failure must never fail
    // the health tick itself.
    try {
      const fnUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`
      void fetch(fnUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ template: 'system_alert', status, message }),
      }).catch((err) => console.warn('[health] system_alert email dispatch failed:', err))
    } catch (e) {
      console.warn('[health] system_alert email dispatch threw:', e)
    }
  }

  return jsonResponse(
    {
      ok: status === 'ok',
      status,
      previous,
      db: { ok: db.ok, latencyMs: db.latencyMs },
      frontend: { ok: frontendOk, version: frontendVersion },
      errorCount10m: errorCount,
      alerted,
      timestamp: new Date().toISOString(),
    },
    200,
    corsHeaders,
  )
})
