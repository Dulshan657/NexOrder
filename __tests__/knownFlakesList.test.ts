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
  it('names the Order home flake, and no longer excuses the PO Inbox encryption test', () => {
    for (const file of ['__tests__/kitchenHomeView.test.tsx']) {
      const flake = entry(file)
      expect(flake, `${file} is not listed`).toBeDefined()
      expect(flake?.reason.trim(), `${file} has no reason`).toBeTruthy()
      expect(flake?.since).toBe('2026-11-05')
    }
    // NX-0025 fixed the bug behind this one, so a failure there is real again.
    expect(entry('__tests__/poInbox.encryption.test.ts')).toBeUndefined()
  })

  it('still holds the four earlier entries', () => {
    const earlier = flakes.filter((flake) => flake.since === '2026-10-13').map((flake) => flake.file)
    expect(earlier).toEqual([
      '__tests__/receiveMixedPallet.test.tsx',
      '__tests__/a11y/qrApproval.test.tsx',
      '__tests__/productImportCategories.test.tsx',
      '__tests__/hoReCaFormReps.test.tsx',
    ])
    expect(flakes).toHaveLength(5)
  })
})
