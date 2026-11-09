import { describe, it, expect } from 'vitest'
import { normaliseTargetArgs, formatProblem, exitCodeFor } from '../scripts/lib/homeBinsCli.mjs'
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
