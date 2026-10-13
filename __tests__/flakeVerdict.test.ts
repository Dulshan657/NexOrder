import { describe, it, expect } from 'vitest';
import {
  classifyFailure,
  failedTestNames,
  failingTestsNotOnBase,
  INITIAL_RUNS,
  MIXED_RUNS,
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

// Found by the gate's second review: a file that fails to LOAD (bad import,
// failing afterAll) is status "failed" with no failed test under it, so the
// per-test comparison saw nothing new and excused a broken import inside a
// file main already had red. The file-level failure must count as a name.
describe('failedTestNames', () => {
  it('lists the failing tests of a file', () => {
    expect(
      failedTestNames({
        status: 'failed',
        message: '',
        assertionResults: [
          { fullName: 'badge > one', status: 'failed' },
          { fullName: 'badge > two', status: 'passed' },
        ],
      }),
    ).toEqual(['badge > one']);
  });

  it('names a file-level failure by its first message line when no test failed', () => {
    expect(
      failedTestNames({
        status: 'failed',
        message: 'Failed to load url ./missing\n    at stack',
        assertionResults: [],
      }),
    ).toEqual(['[file failed] Failed to load url ./missing']);
  });

  it('a new load failure on the tip is a new failure against a base red for another reason', () => {
    const tip = failedTestNames({ status: 'failed', message: 'Failed to load url ./missing', assertionResults: [] });
    expect(failingTestsNotOnBase(tip, ['badge > one'])).toEqual(['[file failed] Failed to load url ./missing']);
  });
});

