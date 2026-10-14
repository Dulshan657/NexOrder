import { describe, it, expect } from 'vitest';
import { judgeFailFirst, testOutcome } from '../scripts/lib/failFirstVerdict.mjs';

// The shape scripts/gate-reporter.mjs writes: per module, its state, its
// failure keys and the full names of the tests that passed.
const report = (modules: Record<string, { state: string; keys?: string[]; passed?: string[] }>) => ({
  modules: Object.fromEntries(Object.entries(modules).map(([f, m]) => [f, { keys: [], passed: [], ...m }])),
  unhandled: [],
});

describe('testOutcome', () => {
  const F = '__tests__/badge.test.ts';

  it('reads passed, failed, load-error and missing', () => {
    expect(testOutcome(report({ [F]: { state: 'passed', passed: ['badge > a'] } }), F, 'badge > a')).toBe('passed');
    expect(testOutcome(report({ [F]: { state: 'failed', keys: ['badge > a'] } }), F, 'badge > a')).toBe('failed');
    expect(testOutcome(report({ [F]: { state: 'failed', keys: ["[module] Cannot find module '../lib/x'"] } }), F, 'badge > a')).toBe('load-error');
    expect(testOutcome(report({}), F, 'badge > a')).toBe('missing');
    expect(testOutcome(report({ [F]: { state: 'passed', passed: ['badge > b'] } }), F, 'badge > a')).toBe('missing');
    expect(testOutcome(null, F, 'badge > a')).toBe('missing');
  });

  it('a hook error on the enclosing suite fails the test', () => {
    const r = report({ [F]: { state: 'failed', keys: ['badge [suite] beforeAll blew up'] } });
    expect(testOutcome(r, F, 'badge > a')).toBe('failed');
  });

  it('a suite error on a sibling suite does not', () => {
    const r = report({ [F]: { state: 'failed', keys: ['badgeX [suite] boom'], passed: ['badge > a'] } });
    expect(testOutcome(r, F, 'badge > a')).toBe('passed');
  });
});

describe('judgeFailFirst', () => {
  it('fails on the base and passes on the tip -> proven', () => {
    expect(judgeFailFirst({ base: 'failed', tip: 'passed' })).toEqual({ verdict: 'proven', blocking: false });
  });

  it('cannot load on the base -> proven-by-absence, a note not a block', () => {
    expect(judgeFailFirst({ base: 'load-error', tip: 'passed' })).toEqual({ verdict: 'proven-by-absence', blocking: false });
  });

  it('a test that also passes on the base is not-fail-first', () => {
    expect(judgeFailFirst({ base: 'passed', tip: 'passed' })).toEqual({ verdict: 'not-fail-first', blocking: true });
  });

  it('red on the tip blocks whatever the base did', () => {
    expect(judgeFailFirst({ base: 'failed', tip: 'failed' })).toEqual({ verdict: 'tip-red', blocking: true });
    expect(judgeFailFirst({ base: 'failed', tip: 'load-error' })).toEqual({ verdict: 'tip-red', blocking: true });
  });

  it('a named test the tip does not have blocks', () => {
    expect(judgeFailFirst({ base: 'missing', tip: 'missing' })).toEqual({ verdict: 'unknown-test', blocking: true });
  });

  it('a test that did not run on the base (skipped, conditional) blocks', () => {
    expect(judgeFailFirst({ base: 'missing', tip: 'passed' })).toEqual({ verdict: 'base-not-run', blocking: true });
  });
});
