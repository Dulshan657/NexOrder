// What the gate may excuse is a decision, so the list is pinned rather than left
// to drift. Delete an entry here and in config/knownFlakes.json when its test is
// fixed. How a listing is applied is covered by flakeVerdict.test.ts.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface KnownFlake {
  file: string
  reason: string
  since: string
}

const flakes: KnownFlake[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'config/knownFlakes.json'), 'utf8'),
)

const entry = (file: string): KnownFlake | undefined => flakes.find((flake) => flake.file === file)

describe('known flakes list', () => {
  it('names the Order home and PO Inbox encryption flakes with a reason and a date', () => {
    for (const file of ['__tests__/kitchenHomeView.test.tsx', '__tests__/poInbox.encryption.test.ts']) {
      const flake = entry(file)
      expect(flake, `${file} is not listed`).toBeDefined()
      expect(flake?.reason.trim(), `${file} has no reason`).toBeTruthy()
      expect(flake?.since).toBe('2026-11-05')
    }
    // This one is a live product bug, so the entry has to say so or it reads as test noise.
    expect(entry('__tests__/poInbox.encryption.test.ts')?.reason).toContain('00018')
  })

  it('still holds the four earlier entries', () => {
    const earlier = flakes.filter((flake) => flake.since === '2026-10-13').map((flake) => flake.file)
    expect(earlier).toEqual([
      '__tests__/receiveMixedPallet.test.tsx',
      '__tests__/a11y/qrApproval.test.tsx',
      '__tests__/productImportCategories.test.tsx',
      '__tests__/hoReCaFormReps.test.tsx',
    ])
    expect(flakes).toHaveLength(6)
  })
})
