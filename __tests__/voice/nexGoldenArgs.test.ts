import { describe, it, expect } from 'vitest'
import { parseNexGoldenArgs } from '../../scripts/lib/nexGoldenArgs.mjs'

describe('nexGoldenArgs', () => {
  it('refuses any env but dev', () => {
    // The runner signs in with the seeded demo password and spends voice minutes:
    // a tenant has neither demo logins nor Nex, and must never be its target.
    expect(() => parseNexGoldenArgs(['--env=amadiya'])).toThrow(/dev only/)
    expect(() => parseNexGoldenArgs([])).toThrow(/--env=dev/)
    expect(() => parseNexGoldenArgs(['--env', 'dev'])).toThrow(/--env=dev/)
    expect(parseNexGoldenArgs(['--env=dev'])).toEqual({ env: 'dev', only: null })
  })

  it('takes an optional comma list of case ids', () => {
    expect(parseNexGoldenArgs(['--env=dev', '--only=a,b'])).toEqual({ env: 'dev', only: ['a', 'b'] })
    expect(() => parseNexGoldenArgs(['--env=dev', '--bogus'])).toThrow(/--bogus/)
  })
})
