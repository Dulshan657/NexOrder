// Should this deploy be allowed to proceed, given what git says?
//
// Split out of scripts/deploy.mjs so the DECISION is pure and testable and only
// the git calls live in the script. A process gate that cannot be exercised in
// CI is a gate nobody can change with confidence — and this one is only ever
// exercised by hand, against a paying client, at the moment you least want a
// surprise.
//
// See `requireReleaseTag` in scripts/deploy.mjs for why the three conditions
// are what they are.

/** Tags that mark a verified release. */
export const RELEASE_TAG_RE = /^rel-/

/**
 * @typedef {object} GitFacts
 * @property {string}   kind         target kind — only 'tenant' is gated
 * @property {boolean}  isRepo       false when git could not be consulted at all
 * @property {boolean}  dirty        uncommitted changes present
 * @property {string[]} tagsAtHead   every tag pointing at HEAD
 * @property {string|null} mainRef   the ref main was found as, or null
 * @property {boolean}  onMain       HEAD is an ancestor of mainRef (ignored when mainRef is null)
 */

/**
 * @param {GitFacts} facts
 * @returns {{ ok: true, tags: string[], mainRef: string|null, warning: string|null }
 *          | { ok: false, problem: string, fix: string }}
 */
export function checkReleaseTag(facts) {
  if (facts.kind !== 'tenant') {
    return { ok: true, tags: [], mainRef: facts.mainRef, warning: null }
  }

  if (!facts.isRepo) {
    return {
      ok: false,
      problem: 'this is not a git checkout, so nothing can be verified.',
      fix: 'Deploy a tenant from a checkout of this repository.',
    }
  }

  if (facts.dirty) {
    return {
      ok: false,
      problem: 'the working tree has uncommitted changes.',
      fix: 'Whatever is uncommitted would be built and is in no tag. Commit or stash it first.',
    }
  }

  const release = facts.tagsAtHead.filter((t) => RELEASE_TAG_RE.test(t))
  if (!release.length) {
    return {
      ok: false,
      problem: 'HEAD is not at a release tag.',
      fix:
        'Verify the build on dev first, then tag the commit you verified:\n' +
        '    git tag -a rel-YYYY-MM-DD -m "what is in this release"\n' +
        '    git push origin rel-YYYY-MM-DD\n' +
        '  then check that tag out in this workspace and deploy again.',
    }
  }

  // A missing main is a WARNING, not a refusal. The tenant workspace is a
  // detached worktree and may legitimately have no local main; refusing over a
  // missing ref would be the gate failing at the job it exists to do. The tag
  // itself still had to be created deliberately.
  if (facts.mainRef === null) {
    return {
      ok: true,
      tags: release,
      mainRef: null,
      warning:
        `neither origin/main nor main is present here, so "${release[0]}" could not be\n` +
        '  confirmed as merged. Proceeding on the tag alone. Run `git fetch origin`\n' +
        '  in this workspace to restore the check.',
    }
  }

  if (!facts.onMain) {
    return {
      ok: false,
      problem: `"${release[0]}" is not an ancestor of ${facts.mainRef}.`,
      fix:
        'A tag on an unmerged branch is a private commit with a label on it.\n' +
        '  Merge to main, push, and tag the merged commit.',
    }
  }

  return { ok: true, tags: release, mainRef: facts.mainRef, warning: null }
}
