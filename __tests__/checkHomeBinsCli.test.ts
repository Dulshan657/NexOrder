import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  normaliseTargetArgs,
  formatProblem,
  exitCodeFor,
  exitCodeForError,
  EXIT_COULD_NOT_RUN,
} from '../scripts/lib/homeBinsCli.mjs'
import { readTargetName, TargetError } from '../scripts/lib/env.mjs'

describe('normaliseTargetArgs', () => {
  it('turns "--target dev" into the --env=dev that env.mjs reads', () => {
    const argv = normaliseTargetArgs(['--target', 'dev'])
    expect(argv).toEqual(['--env=dev'])
    expect(readTargetName(argv)).toBe('dev')
  })

  it('turns "--target=dev" into --env=dev too', () => {
    expect(normaliseTargetArgs(['--target=dev'])).toEqual(['--env=dev'])
  })

  it('leaves --env=<name> and other arguments alone', () => {
    expect(normaliseTargetArgs(['--env=dev', '--quiet'])).toEqual(['--env=dev', '--quiet'])
  })

  it('refuses --target with no name, rather than guessing one', () => {
    expect(() => normaliseTargetArgs(['--target'])).toThrow(TargetError)
    expect(() => normaliseTargetArgs(['--target', '--env=dev'])).toThrow(TargetError)
  })

  it('names no target when none was given, so resolveTarget refuses to default', () => {
    expect(() => readTargetName(normaliseTargetArgs([]))).toThrow(/No target environment/)
  })
})

describe('formatProblem', () => {
  it('is one line: warehouse, SKU, bin, code and message', () => {
    const line = formatProblem(
      { code: 'WH-1', name: 'Main' },
      { sku: 'TST-HOME-200', binCode: 'TST-A-01-1' },
      { code: 'inactive', message: 'Bin TST-A-01-1 is inactive, so putaway never offers it.' },
    )
    expect(line).toBe(
      'WH-1 | TST-HOME-200 | TST-A-01-1 | inactive | Bin TST-A-01-1 is inactive, so putaway never offers it.',
    )
    expect(line).not.toContain('\n')
  })
})

describe('exitCodeFor', () => {
  it('is 0 with no problems and 1 with any', () => {
    expect(exitCodeFor(0)).toBe(0)
    expect(exitCodeFor(1)).toBe(1)
    expect(exitCodeFor(40)).toBe(1)
  })
})

// The documented contract: 2 means "could not run", never "all clear" and never
// confused with 1 ("problems found"). A TargetError (no credentials, a bare
// --target, credentials that belong to another project) used to exit 1.
describe('exitCodeForError', () => {
  it('maps a TargetError to 2', () => {
    let caught: unknown
    try { normaliseTargetArgs(['--target']) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(TargetError)
    expect(EXIT_COULD_NOT_RUN).toBe(2)
    expect(exitCodeForError(caught)).toBe(2)
    expect(exitCodeForError(new TargetError('Missing SUPABASE_SERVICE_ROLE_KEY'))).toBe(2)
  })

  it('maps any other failure to 2 as well', () => {
    expect(exitCodeForError(new Error('warehouse list failed: timeout'))).toBe(2)
    expect(exitCodeForError('a string')).toBe(2)
  })
})

describe('check-home-bins exit code', () => {
  const ROOT = resolve(__dirname, '..')
  const run = (args: string[]) => spawnSync(
    process.execPath,
    [resolve(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'scripts/check-home-bins.mjs', ...args],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NEXORDER_ENV: '' }, timeout: 60_000 },
  )

  it('exits 2 for a bare --target, before it reads anything', () => {
    const r = run(['--target'])
    expect(r.stderr).toContain('--target needs a name')
    expect(r.status).toBe(2)
  }, 60_000)

  it('exits 2 when no target is named', () => {
    const r = run([])
    expect(r.stderr).toMatch(/No target environment/)
    expect(r.status).toBe(2)
  }, 60_000)
})
