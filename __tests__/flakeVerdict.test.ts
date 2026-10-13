import { describe, it, expect } from 'vitest';
import {
  classifyFailure,
  failingTestsNotOnBase,
  gateVerdict,
  INITIAL_RUNS,
  MIXED_RUNS,
  stripRoot,
} from '../scripts/lib/flakeVerdict.mjs';

// true = the file passed that run, false = it failed.
const pass = (n: number) => Array(n).fill(true);
const fail = (n: number) => Array(n).fill(false);

describe('classifyFailure (gate flake protocol)', () => {
  it('reruns 3x first and 5x once a side is mixed', () => {
    expect(INITIAL_RUNS).toBe(3);
    expect(MIXED_RUNS).toBe(5);
  });

  it('fails only on the tip -> regression, blocking', () => {
    expect(classifyFailure({ tip: fail(3), base: pass(3) })).toEqual({
      verdict: 'regression',
      blocking: true,
      moreRuns: 0,
    });
  });

  it('fails on both tip and base -> pre-existing, not a regression of this change', () => {
    expect(classifyFailure({ tip: fail(3), base: fail(3) })).toEqual({
      verdict: 'pre-existing',
      blocking: false,
      moreRuns: 0,
    });
  });

  it('passes alone on the tip every time -> flake (failed only inside the suite), blocking', () => {
    expect(classifyFailure({ tip: pass(3), base: pass(3) })).toEqual({
      verdict: 'flake',
      blocking: true,
      moreRuns: 0,
    });
  });

  it('a mixed side with fewer than 5 runs asks for more runs before judging', () => {
    expect(classifyFailure({ tip: [false, true, false], base: pass(3) })).toEqual({
      verdict: 'undecided',
      blocking: true,
      moreRuns: 2,
    });
    expect(classifyFailure({ tip: fail(3), base: [true, false, true] }).moreRuns).toBe(2);
  });

  it('still mixed after 5 runs -> flake, blocking until ticketed', () => {
    expect(classifyFailure({ tip: [false, true, false, true, false], base: pass(5) })).toEqual({
      verdict: 'flake',
      blocking: true,
      moreRuns: 0,
    });
  });

  it('consistent tip failure over a flaky base -> flake, never excused as pre-existing', () => {
    expect(classifyFailure({ tip: fail(5), base: [true, false, true, true, false] })).toEqual({
      verdict: 'flake',
      blocking: true,
      moreRuns: 0,
    });
  });

  it('refuses to judge with no runs on a side', () => {
    expect(() => classifyFailure({ tip: [], base: pass(3) })).toThrow(/at least one run/);
  });

  // Found by the gate on its own PR: judging per FILE let a new failing test hide
  // inside a file main already had red, which is exactly the two weeks main spent
  // red on paymentStatusBadge. "pre-existing" must mean every failing TEST is.
  it('a red-on-both file with a test failing only on the tip -> regression, not pre-existing', () => {
    expect(
      classifyFailure({ tip: fail(3), base: fail(3), newFailingTests: ['badge > formats a new case'] }),
    ).toEqual({ verdict: 'regression', blocking: true, moreRuns: 0 });
  });

  it('a red-on-both file failing the same tests on both sides stays pre-existing', () => {
    expect(classifyFailure({ tip: fail(3), base: fail(3), newFailingTests: [] }).verdict).toBe('pre-existing');
  });
});

describe('failingTestsNotOnBase', () => {
  it('returns tip failures the base does not share, by full test name', () => {
    expect(failingTestsNotOnBase(['a > one', 'a > two'], ['a > one'])).toEqual(['a > two']);
  });

  it('is empty when every tip failure already fails on the base', () => {
    expect(failingTestsNotOnBase(['a > one'], ['a > one', 'a > three'])).toEqual([]);
  });
});

describe('stripRoot', () => {
  it('makes the same load failure in nexgate and nexgate-base compare equal', () => {
    const tip = stripRoot("Cannot find module './x' imported from C:/w/nexgate/__tests__/p.test.ts", String.raw`C:\w\nexgate`);
    const base = stripRoot("Cannot find module './x' imported from C:/w/nexgate-base/__tests__/p.test.ts", String.raw`C:\w\nexgate-base`);
    expect(tip).toBe("Cannot find module './x' imported from <root>/__tests__/p.test.ts");
    expect(base).toBe(tip);
  });

  it('strips a backslash-form root too', () => {
    expect(stripRoot(String.raw`at C:\w\nexgate\a.ts`, String.raw`C:\w\nexgate`)).toBe(String.raw`at <root>\a.ts`);
  });
});

// Found by the gate's third review: `--base` produced exit 0 / GO, and a partial
// run wrote `go: true`. Only a full run against the merge-base can say GO.
describe('gateVerdict', () => {
  const full = { partial: false, overridden: false };

  it('GO only when nothing failed, every row ran and the base was not overridden', () => {
    expect(gateVerdict({ anyFailed: false, ...full })).toEqual({ verdict: 'GO', go: true, exitCode: 0 });
  });

  it('any failure is NO-GO, whatever else', () => {
    expect(gateVerdict({ anyFailed: true, partial: true, overridden: true })).toEqual({
      verdict: 'NO-GO',
      go: false,
      exitCode: 1,
    });
  });

  it('a --rows run that passed is PARTIAL, never go', () => {
    expect(gateVerdict({ anyFailed: false, partial: true, overridden: false })).toEqual({
      verdict: 'PARTIAL',
      go: false,
      exitCode: 3,
    });
  });

  it('a --base run that passed is PARTIAL, never go', () => {
    expect(gateVerdict({ anyFailed: false, partial: false, overridden: true })).toEqual({
      verdict: 'PARTIAL',
      go: false,
      exitCode: 3,
    });
  });
});
