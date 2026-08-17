import { describe, expect, it } from 'vitest'

import { PASSWORD_MIN_LENGTH, planPasswordChange } from '../scripts/lib/passwordChange.mjs'

/**
 * NOTE the `v.ok === true` / `v.ok === false` spellings below. `tsconfig` has
 * `strict` off, so a discriminated union narrows ONLY on an explicit comparison
 * — `if (!v.ok)` compiles here and leaves the type unnarrowed, and the suite
 * passes while `npx tsc --noEmit` fails. Repo-wide gotcha; see releaseTag.test.ts.
 *
 * This is the argument surface of the one script that can change a credential on
 * a paying client's database. It is exercised by hand, rarely, so every refusal
 * it can give is pinned here rather than discovered at the keyboard.
 */

const OK_ENV = { NEW_PASSWORD: 'a-long-enough-password' }

describe('planPasswordChange', () => {
  it('plans a set when given an address and a password in the environment', () => {
    const v = planPasswordChange({ argv: ['--email=Someone@Example.com'], env: OK_ENV })
    expect(v.ok).toBe(true)
    if (v.ok === true) {
      expect(v.mode).toBe('set')
      // Lower-cased so the lookup against the project's user list is stable;
      // GoTrue stores addresses folded.
      expect(v.email).toBe('someone@example.com')
      expect(v.password).toBe('a-long-enough-password')
      expect(v.dryRun).toBe(false)
    }
  })

  it('carries --dry-run through', () => {
    const v = planPasswordChange({ argv: ['--email=a@b.co', '--dry-run'], env: OK_ENV })
    expect(v.ok).toBe(true)
    if (v.ok === true) expect(v.dryRun).toBe(true)
  })

  it('allows --list with no address and no password', () => {
    // Listing is how you find out what a project actually holds before deciding
    // to act on it, so it must not require the things you do not know yet.
    const v = planPasswordChange({ argv: ['--list'], env: {} })
    expect(v.ok).toBe(true)
    if (v.ok === true) {
      expect(v.mode).toBe('list')
      expect(v.email).toBeNull()
      expect(v.password).toBeNull()
    }
  })

  it('refuses --email in space form rather than guessing', () => {
    const v = planPasswordChange({ argv: ['--email', 'a@b.co'], env: OK_ENV })
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.problem).toMatch(/space form/)
  })

  it('refuses when no account is named', () => {
    const v = planPasswordChange({ argv: [], env: OK_ENV })
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.fix).toMatch(/--list/)
  })

  it('refuses something that is not an address', () => {
    const v = planPasswordChange({ argv: ['--email=dulshanb'], env: OK_ENV })
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.problem).toMatch(/not an email address/)
  })

  it('refuses when NEW_PASSWORD is absent, and says where it belongs', () => {
    const v = planPasswordChange({ argv: ['--email=a@b.co'], env: {} })
    expect(v.ok).toBe(false)
    if (v.ok === false) {
      expect(v.problem).toMatch(/NEW_PASSWORD/)
      expect(v.fix).toMatch(/never from the command line/)
    }
  })

  it('refuses an empty NEW_PASSWORD the same way as an absent one', () => {
    const v = planPasswordChange({ argv: ['--email=a@b.co'], env: { NEW_PASSWORD: '' } })
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.problem).toMatch(/NEW_PASSWORD/)
  })

  it('refuses a password below the minimum, naming both numbers', () => {
    const short = 'x'.repeat(PASSWORD_MIN_LENGTH - 1)
    const v = planPasswordChange({ argv: ['--email=a@b.co'], env: { NEW_PASSWORD: short } })
    expect(v.ok).toBe(false)
    if (v.ok === false) {
      expect(v.problem).toContain(String(PASSWORD_MIN_LENGTH - 1))
      expect(v.problem).toContain(String(PASSWORD_MIN_LENGTH))
    }
  })

  it('accepts a password exactly at the minimum', () => {
    const v = planPasswordChange({
      argv: ['--email=a@b.co'],
      env: { NEW_PASSWORD: 'x'.repeat(PASSWORD_MIN_LENGTH) },
    })
    expect(v.ok).toBe(true)
  })

  it('refuses surrounding whitespace instead of silently setting it', () => {
    // The expensive failure: set successfully, then appears not to work, with
    // nothing on screen to explain why. Almost always a paste with a newline.
    const v = planPasswordChange({
      argv: ['--email=a@b.co'],
      env: { NEW_PASSWORD: 'a-long-enough-password\n' },
    })
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.problem).toMatch(/whitespace/)
  })

  it('never reads a password from argv', () => {
    // The guarantee the whole module exists for: a password on the command line
    // is in shell history and in `ps`, so it must not be honoured even when
    // spelled the way a caller would guess.
    const v = planPasswordChange({ argv: ['--email=a@b.co', '--password=sneaky-and-long'], env: {} })
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.problem).toMatch(/NEW_PASSWORD/)
  })

  it('lists without touching an invalid address or a short password', () => {
    // --list is checked first on purpose: it writes nothing, so the argument
    // checks that exist to protect a write have nothing to protect.
    const v = planPasswordChange({
      argv: ['--list', '--email=nonsense', '--dry-run'],
      env: { NEW_PASSWORD: 'x' },
    })
    expect(v.ok).toBe(true)
    if (v.ok === true) expect(v.mode).toBe('list')
  })
})
