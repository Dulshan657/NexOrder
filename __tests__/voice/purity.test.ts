// lib/voice's browser-side tool layer is PURE: no React, no network, no clock of
// its own (the clock arrives as ctx.now). It runs under the node vitest project,
// and a tool that reached for Date.now() would pass today and answer wrongly in a
// test that fixes the date. This reads the source and refuses the escape hatches.
//
// It lists its files by name rather than scanning the directory: realtimeClient.ts
// and the hooks that follow in lib/voice legitimately use fetch and timers.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', 'lib', 'voice')

const TOP_LEVEL = [
  'canUseVoiceAssistant.ts', 'context.ts', 'findCustomer.ts', 'period.ts', 'realtimeEvents.ts',
  'resultBudget.ts', 'runVoiceTool.ts', 'toolArgs.ts', 'transcript.ts',
]

const PURE_FILES = [
  ...TOP_LEVEL,
  ...readdirSync(join(ROOT, 'tools')).filter((f) => f.endsWith('.ts')).map((f) => join('tools', f)),
]

const FORBIDDEN: Array<[string, RegExp]> = [
  ['Date.now()', /\bDate\.now\s*\(/],
  ['new Date() with no argument', /\bnew Date\s*\(\s*\)/],
  ['performance.now()', /\bperformance\.now\s*\(/],
  ['Math.random()', /\bMath\.random\s*\(/],
  ['fetch', /\bfetch\s*\(/],
  ['a timer', /\bset(Timeout|Interval)\s*\(/],
  ['React', /from\s+['"]react['"]/],
  ['the Supabase client', /from\s+['"][^'"]*lib\/supabase['"]/],
  ['the error reporter', /from\s+['"][^'"]*errorReporter['"]/],
  ['console output', /\bconsole\.(log|info|debug|warn|error)\b/],
  ['window or document', /\b(window|document|localStorage|navigator)\./],
]

function strippedSource(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('lib/voice tool layer purity', () => {
  it('finds the files it is meant to guard', () => {
    expect(PURE_FILES.length).toBeGreaterThanOrEqual(TOP_LEVEL.length + 10)
  })

  it.each(PURE_FILES)('%s uses no clock, network, timer, DOM or logger', (file) => {
    const source = strippedSource(file)
    const found = FORBIDDEN.filter(([, pattern]) => pattern.test(source)).map(([label]) => label)
    expect(found).toEqual([])
  })

  it.each(PURE_FILES)('%s imports the shared voice contract without a file extension', (file) => {
    const source = strippedSource(file)
    expect(source).not.toMatch(/_shared\/voice\/[A-Za-z]+\.ts['"]/)
  })
})
