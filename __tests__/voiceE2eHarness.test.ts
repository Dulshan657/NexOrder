// NX-0009 — the Nex-by-voice instrument's moving parts, checked without a
// browser, a microphone or OpenAI: where the project sits (so nothing runs it by
// accident), how it reads a spoken number, and what the recordings it plays are.
//
// Modules are loaded inside each test, not at the top, so that on a checkout
// without the harness the file still loads and each test fails on its own.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const VOICE_DIR = resolve(ROOT, 'tests/voice-e2e')

interface ProjectLike {
  name?: string
  testDir?: string
}

describe('voice e2e harness', () => {
  it('registers a voice project outside tests/e2e', async () => {
    const config = (await import('../playwright.config')).default as { testDir?: string; projects?: ProjectLike[] }
    const projects = config.projects ?? []
    const voice = projects.find((p) => p.name === 'voice')
    expect(voice, 'a project named voice').toBeDefined()
    expect(resolve(ROOT, voice?.testDir ?? '')).toBe(VOICE_DIR)

    // The default suite (`npm run test:e2e`, the chromium project) inherits the
    // top-level testDir, and CI runs only the a11y project: neither reaches it.
    const defaultDir = resolve(ROOT, config.testDir ?? '')
    expect(VOICE_DIR.startsWith(defaultDir + '\\') || VOICE_DIR.startsWith(defaultDir + '/')).toBe(false)
    const a11y = projects.find((p) => p.name === 'a11y')
    expect(resolve(ROOT, a11y?.testDir ?? '')).not.toBe(VOICE_DIR)
  })

  it('matches a count said as digits or words, and no other count', async () => {
    const { spokenForms } = await import('../tests/voice-e2e/spokenForms')
    const twentyTwo = spokenForms(22)
    expect('This month we shipped 22 orders.').toMatch(twentyTwo)
    expect('Twenty-two orders went out.').toMatch(twentyTwo)
    expect('twenty two orders went out').toMatch(twentyTwo)
    expect('We shipped 222 orders.').not.toMatch(twentyTwo)
    expect('We shipped 21 orders.').not.toMatch(twentyTwo)
    expect('Twenty-one orders went out.').not.toMatch(twentyTwo)

    expect('Nineteen orders came in.').toMatch(spokenForms(19))
    expect('Thirty orders came in.').toMatch(spokenForms(30))
    expect('No, zero orders.').toMatch(spokenForms(0))
  })

  it('ships recordings as PCM16 mono 24 kHz with silence either side', () => {
    for (const name of ['processed', 'came-in']) {
      const wav = readFileSync(join(VOICE_DIR, 'fixtures', `${name}.wav`))
      expect(wav.toString('ascii', 0, 4), name).toBe('RIFF')
      expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
      expect(wav.readUInt16LE(20), 'PCM').toBe(1)
      expect(wav.readUInt16LE(22), 'mono').toBe(1)
      expect(wav.readUInt32LE(24), 'sample rate').toBe(24_000)
      expect(wav.readUInt16LE(34), 'bits').toBe(16)

      const samples = wav.subarray(44)
      const twoSeconds = 2 * 24_000 * 2
      const silent = (bytes: Buffer) => bytes.every((b) => b === 0)
      expect(silent(samples.subarray(0, twoSeconds)), `${name}: silence before`).toBe(true)
      expect(silent(samples.subarray(samples.length - twoSeconds)), `${name}: silence after`).toBe(true)
      expect(silent(samples.subarray(twoSeconds, samples.length - twoSeconds)), `${name}: speech between`).toBe(false)
    }
  })
})
