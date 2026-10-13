import { describe, it, expect } from 'vitest';
import { failureKeys } from '../scripts/lib/failureKeys.mjs';

// Fakes in the shape of vitest 4's reported-task API (TestModule / TestSuite /
// TestCase): errors(), children.allSuites(), children.allTests('failed').
type Err = { message: string };
const test = (fullName: string, errors: Err[] = [{ message: 'expected 1 to be 2' }]) => ({
  fullName,
  result: () => ({ state: 'failed', errors }),
});
const suite = (fullName: string, errors: Err[] = []) => ({ fullName, errors: () => errors });
const module = ({
  errors = [] as Err[],
  suites = [] as ReturnType<typeof suite>[],
  failedTests = [] as ReturnType<typeof test>[],
}) => ({
  errors: () => errors,
  children: {
    allSuites: () => suites[Symbol.iterator](),
    allTests: (state: string) => (state === 'failed' ? failedTests : [])[Symbol.iterator](),
  },
});

describe('failureKeys (every failed task, at every level)', () => {
  it('a failing test is keyed by its full name', () => {
    expect(failureKeys(module({ failedTests: [test('badge > one')] }), 'C:/w')).toEqual(['badge > one']);
  });

  it('a module-level error (bad import, top-level hook) is keyed by its first line', () => {
    expect(
      failureKeys(module({ errors: [{ message: "Cannot find module './x'\n    at stack" }] }), 'C:/w'),
    ).toEqual(["[module] Cannot find module './x'"]);
  });

  // The gate's fourth review: a hook that throws INSIDE a describe lands on that
  // suite's own result, which vitest's JSON reporter never surfaces.
  it('a hook error inside a describe is keyed on its suite, beside the failing tests', () => {
    expect(
      failureKeys(
        module({
          suites: [suite('badge'), suite('badge > teardown', [{ message: 'afterAll threw' }])],
          failedTests: [test('badge > one')],
        }),
        'C:/w',
      ),
    ).toEqual(['badge > teardown [suite] afterAll threw', 'badge > one']);
  });

  it('strips the workdir so nexgate and nexgate-base agree', () => {
    const tip = failureKeys(module({ errors: [{ message: 'imported from C:/w/nexgate/a.ts' }] }), String.raw`C:\w\nexgate`);
    const base = failureKeys(module({ errors: [{ message: 'imported from C:/w/nexgate-base/a.ts' }] }), String.raw`C:\w\nexgate-base`);
    expect(tip).toEqual(['[module] imported from <root>/a.ts']);
    expect(base).toEqual(tip);
  });

  it('every error of a suite counts, not just the first', () => {
    expect(
      failureKeys(module({ suites: [suite('s', [{ message: 'beforeAll threw' }, { message: 'afterAll threw' }])] }), 'C:/w'),
    ).toEqual(['s [suite] beforeAll threw', 's [suite] afterAll threw']);
  });

  it('a passing module has no keys', () => {
    expect(failureKeys(module({ suites: [suite('ok')] }), 'C:/w')).toEqual([]);
  });
});
