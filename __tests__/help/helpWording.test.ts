// NX-0038 A14: the help says "location", not "bin" — not every place is a bin.
// Reads the article sources (and the manifest summaries) for the word in prose,
// ignoring imports, so image file names like putaway-bin.png may stay.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const HELP = join(__dirname, '..', '..', 'components', 'help')
const FILES = [
  ...readdirSync(join(HELP, 'articles')).filter((f) => f.endsWith('.tsx')).map((f) => join(HELP, 'articles', f)),
  join(HELP, 'manifest.ts'),
  join(__dirname, '..', '..', 'components', 'inventory', 'PutawayQueuePage.tsx'),
]

describe('help wording', () => {
  it('no article calls a place a bin', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(import|\/\/|\*)/.test(line)) return
        if (/\b(bin|bins|Bin|Bins)\b/.test(line.replace(/[\w-]+\.(png|jpg)/g, ''))) offenders.push(`${file}:${i + 1}  ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
