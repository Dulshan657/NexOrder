import { describe, it, expect } from 'vitest';
import { classifyFailure, INITIAL_RUNS, MIXED_RUNS } from '../scripts/lib/flakeVerdict.mjs';

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
});
