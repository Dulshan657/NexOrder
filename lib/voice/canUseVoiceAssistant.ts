// Who is offered Nex Assistant at all: the four sales roles.
//
// The list is NOT written out here. It is VOICE_ROLES from the shared voice
// contract, the same array the voice-session Edge Function enforces, so the
// browser's idea of "may use it" cannot drift from the server's. It comes from
// roles.ts, which imports nothing: AppShell imports THIS file statically (it is
// in the entry chunk), so it must never reach toolSchemas.ts and its ten
// module-level tool definitions, which would then ship with the module off.
//
// This is only
// whether to SHOW the launcher; which tools a role may call is decided by
// toolsForRole (see runVoiceTool), and the server refuses anyone else regardless.
//
// Mirrors lib/canSeeOrderValue.ts: a role test, not a module test. Whether the
// tenant has the voice_assistant module is the folded constant
// MODULE_VOICE_ASSISTANT, checked separately where the launcher is mounted.

import { VOICE_ROLES } from '@/supabase/functions/_shared/voice/roles'
import type { UserRole } from '@/types'

export function canUseVoiceAssistant(role: UserRole | string | null | undefined): boolean {
  return typeof role === 'string' && VOICE_ROLES.includes(role)
}
