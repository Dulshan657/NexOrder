// The one time zone the assistant speaks in.
//
// Pure and dependency-free: imported by BOTH runtimes. voice-session (Deno) puts
// today's date in this zone into the prompt, and lib/period.ts (browser)
// resolves "today", "this week" and "last month" in it, so the model and the
// numbers it is handed agree on what day it is.
//
// Fixed for every tenant in v1 (all current tenants are in New South Wales). A
// per-tenant setting is v2: it would move to app_settings and be passed in.
//
// The frontend reads it through lib/period.ts, the one app calendar that Nex,
// the dashboards and the semantic layer share (NX-0008). It is a single string
// constant, so carrying it in the entry bundle ships no voice code; the voice
// gate's own graph is still guarded by __tests__/voice/launcherGateImports.test.ts.

export const APP_TIME_ZONE = 'Australia/Sydney'
