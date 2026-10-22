import { describe, it, expect } from 'vitest'
import {
  ALL_MODULES,
  MODULE_REQUIRES,
  TARGETS,
  assertModuleSet,
} from '../../config/environments.mjs'

describe('voice_assistant module', () => {
  it('is registered and requires sales_orders', () => {
    expect(ALL_MODULES).toContain('voice_assistant')
    expect(MODULE_REQUIRES.voice_assistant).toEqual(['sales_orders'])
    expect(() => assertModuleSet('t', ['sales_orders', 'voice_assistant'])).not.toThrow()
    expect(() => assertModuleSet('t', ['voice_assistant'])).toThrow()
  })

  it('is enabled for dev but not yet for amadiya', () => {
    expect(TARGETS.dev.modules).toContain('voice_assistant')
    // The owner, 2026-10-22: Amadiya gets no new features yet.
    expect(TARGETS.amadiya.modules).not.toContain('voice_assistant')
  })
})
