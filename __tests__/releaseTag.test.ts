import { describe, expect, it } from 'vitest'

import { checkReleaseTag } from '../scripts/lib/releaseTag.mjs'

/**
 * NOTE the `v.ok === true` / `v.ok === false` spellings below. `tsconfig` has
 * `strict` off, so a discriminated union narrows ONLY on an explicit comparison
 * — `if (!v.ok)` compiles here and leaves the type unnarrowed, and the suite
 * passes while `npx tsc --noEmit` fails. Already recorded as a repo-wide gotcha;
 * it caught this file too.
 *
 * The tenant release gate. Tested because it is only ever exercised by hand,
 * against a paying client, at the moment you least want a surprise — and
 * because both of its failure directions are expensive: too loose and an
 * unverified commit reaches production, too tight and it blocks the deploy it
 * exists to protect.
 */

const CLEAN = {
  kind: 'tenant',
  isRepo: true,
  dirty: false,
  tagsAtHead: ['rel-2026-08-13'],
  mainRef: 'origin/main',
  onMain: true,
}

describe('release tag gate', () => {
  it('allows a clean checkout at a release tag that is on main', () => {
    const v = checkReleaseTag(CLEAN)
    expect(v.ok).toBe(true)
    if (v.ok === true) {
      expect(v.tags).toEqual(['rel-2026-08-13'])
      expect(v.warning).toBeNull()
    }
  })

  it('ignores every condition for a non-tenant target', () => {
    // Deploying whatever is checked out IS the point of a demo environment,
    // and it is where a release candidate is verified before it is tagged.
    const v = checkReleaseTag({ ...CLEAN, kind: 'demo', dirty: true, tagsAtHead: [], onMain: false })
    expect(v.ok).toBe(true)
  })

  it('refuses an uncommitted working tree', () => {
    // The edit would be built and is in no tag — the tag would be a lie.
    const v = checkReleaseTag({ ...CLEAN, dirty: true })
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.problem).toMatch(/uncommitted/)
  })

  it('refuses an untagged commit and says how to tag it', () => {
    const v = checkReleaseTag({ ...CLEAN, tagsAtHead: [] })
    expect(v.ok).toBe(false)
    if (v.ok === false) {
      expect(v.problem).toMatch(/not at a release tag/)
      expect(v.fix).toMatch(/git tag -a rel-/)
    }
  })

  it('ignores tags that are not release tags', () => {
    const v = checkReleaseTag({ ...CLEAN, tagsAtHead: ['v1.2.3', 'backup', 'before-migration'] })
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.problem).toMatch(/not at a release tag/)
  })

  it('accepts a release tag alongside unrelated tags', () => {
    const v = checkReleaseTag({ ...CLEAN, tagsAtHead: ['backup', 'rel-2026-08-13'] })
    expect(v.ok).toBe(true)
    if (v.ok === true) expect(v.tags).toEqual(['rel-2026-08-13'])
  })

  it('refuses a release tag that is not an ancestor of main', () => {
    // A tag on an unmerged branch is a private commit with a label on it.
    const v = checkReleaseTag({ ...CLEAN, onMain: false })
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.problem).toMatch(/not an ancestor of origin\/main/)
  })

  it('refuses when git cannot be consulted at all', () => {
    const v = checkReleaseTag({ ...CLEAN, isRepo: false })
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.problem).toMatch(/not a git checkout/)
  })

  it('WARNS rather than refusing when main is absent', () => {
    // The tenant workspace is a detached worktree and may legitimately have no
    // local main. Refusing over a missing ref would be the gate failing at the
    // job it exists to do; the tag still had to be created deliberately.
    const v = checkReleaseTag({ ...CLEAN, mainRef: null, onMain: false })
    expect(v.ok).toBe(true)
    if (v.ok === true) {
      expect(v.warning).toMatch(/could not be/)
      expect(v.warning).toMatch(/git fetch origin/)
    }
  })

  it('checks the tree before the tag', () => {
    // A dirty tree at an untagged commit should complain about the tree: it is
    // the condition the operator can act on without deciding anything.
    const v = checkReleaseTag({ ...CLEAN, dirty: true, tagsAtHead: [] })
    expect(v.ok).toBe(false)
    if (v.ok === false) expect(v.problem).toMatch(/uncommitted/)
  })
})
