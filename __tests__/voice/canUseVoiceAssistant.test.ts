import { describe, it, expect } from 'vitest'
import { UserRole } from '../../types'
import { VOICE_ROLES } from '../../supabase/functions/_shared/voice/toolSchemas'
import { canUseVoiceAssistant } from '../../lib/voice/canUseVoiceAssistant'

describe('canUseVoiceAssistant', () => {
  it('allows the four sales roles', () => {
    expect(canUseVoiceAssistant(UserRole.ADMIN)).toBe(true)
    expect(canUseVoiceAssistant(UserRole.MANAGER)).toBe(true)
    expect(canUseVoiceAssistant(UserRole.FIELD_REP)).toBe(true)
    expect(canUseVoiceAssistant(UserRole.OFFICE_REP)).toBe(true)
  })

  it('refuses every other role, including the hidden QR Staff login', () => {
    expect(canUseVoiceAssistant(UserRole.WAREHOUSE)).toBe(false)
    expect(canUseVoiceAssistant(UserRole.CUSTOMER)).toBe(false)
    expect(canUseVoiceAssistant(UserRole.QR_STAFF)).toBe(false)
    expect(canUseVoiceAssistant('Superuser')).toBe(false)
  })

  it('refuses a missing role', () => {
    expect(canUseVoiceAssistant(undefined)).toBe(false)
    expect(canUseVoiceAssistant(null)).toBe(false)
    expect(canUseVoiceAssistant('')).toBe(false)
  })

  it('agrees with the shared role list the server enforces', () => {
    for (const role of VOICE_ROLES) expect(canUseVoiceAssistant(role)).toBe(true)
  })
})
