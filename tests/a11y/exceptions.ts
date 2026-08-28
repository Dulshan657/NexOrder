// Accessibility findings this project has decided to accept, and the ONLY place
// a browser-tier axe failure may be waved through.
//
// THE RULE: every entry here must have a matching entry in the published
// accessibility statement. A suppression that is not disclosed is not an
// exception, it is an undisclosed defect — and the point of writing a
// conformance claim is that it is true.
//
// Scope matters as much as the entry itself. The brand-colour exception below
// covers LARGE and NON-TEXT uses of #2988de. It does not cover small body text
// in that colour, which needs 4.5:1 and is a plain defect: the 11px "Forgot your
// password?" link was moved to nexgen-blue-dark rather than parked here.

export interface A11yException {
  /** axe rule id, e.g. 'color-contrast'. */
  rule: string
  /**
   * CSS selectors this exception covers. A violation is waved through only if
   * EVERY node axe reports for that rule matches one of these — a rule that has
   * also started failing somewhere else still fails the run.
   */
  selectors: string[]
  /** Why, in one line, in the same words as the public statement. */
  reason: string
}

export const KNOWN_EXCEPTIONS: readonly A11yException[] = [
  // Nothing yet. Entries are added only alongside the statement that discloses
  // them; an empty list is the honest starting position and means the browser
  // tier currently passes on its own merits.
]

/**
 * Split axe violations into those an exception covers and those it does not.
 *
 * Deliberately strict about partial matches: if a rule fires on five nodes and
 * an exception covers four, the violation is NOT excused. Excusing it would
 * quietly widen a narrow, disclosed exception into a general licence.
 */
export function partitionViolations<
  T extends { id: string; nodes: readonly { target: unknown[] }[] },
>(violations: readonly T[]): { failing: T[]; excused: { violation: T; reason: string }[] } {
  const failing: T[] = []
  const excused: { violation: T; reason: string }[] = []

  for (const v of violations) {
    const exception = KNOWN_EXCEPTIONS.find(
      (e) =>
        e.rule === v.id &&
        v.nodes.every((n) => n.target.some((t) => e.selectors.includes(String(t)))),
    )
    if (exception) excused.push({ violation: v, reason: exception.reason })
    else failing.push(v)
  }
  return { failing, excused }
}
