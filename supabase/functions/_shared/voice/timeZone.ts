// The one time zone the assistant speaks in.
//
// Pure and dependency-free: imported by BOTH runtimes. voice-session (Deno) puts
// today's date in this zone into the prompt, and lib/voice/period.ts (browser)
// resolves "today", "this week" and "last month" in it, so the model and the
// numbers it is handed agree on what day it is.
//
// Fixed for every tenant in v1 (all current tenants are in New South Wales). A
// per-tenant setting is v2: it would move to app_settings and be passed in.
//
// Only lib/voice imports this from the frontend, and lib/voice is reached only
// through the lazy VoiceAssistantLauncher chunk, so the entry bundle never
// carries it (__tests__/voice/launcherGateImports.test.ts guards that graph).

export const APP_TIME_ZONE = 'Australia/Sydney'
