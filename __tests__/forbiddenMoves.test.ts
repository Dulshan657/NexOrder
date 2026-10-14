import { describe, it, expect } from 'vitest';
import { applyAllowances, findForbiddenMoves, MOVES, parseDiff, touchesCode } from '../scripts/lib/forbiddenMoves.mjs';

// A minimal unified diff for one file: `lines` are already prefixed with
// '+', '-' or ' '.
const fileDiff = (path: string, lines: string[], { added = false, deleted = false } = {}) =>
  [
    `diff --git a/${path} b/${path}`,
    ...(added ? ['new file mode 100644', '--- /dev/null', `+++ b/${path}`] : []),
    ...(deleted ? ['deleted file mode 100644', `--- a/${path}`, '+++ /dev/null'] : []),
    ...(!added && !deleted ? [`--- a/${path}`, `+++ b/${path}`] : []),
    '@@ -1,3 +1,3 @@',
    ...lines,
  ].join('\n');

const moves = (diff: string, files = {}) => findForbiddenMoves(diff, files).map((m: { move: string }) => m.move);

describe('parseDiff', () => {
  it('splits files and keeps added/removed lines', () => {
    const d = parseDiff(fileDiff('a.ts', ['-old', '+new', ' same']) + '\n' + fileDiff('b.md', ['+x'], { added: true }));
    expect(d.map((f: { path: string }) => f.path)).toEqual(['a.ts', 'b.md']);
    expect(d[0].removed).toEqual(['old']);
    expect(d[0].added).toEqual(['new']);
    expect(d[1].status).toBe('added');
  });
});

describe('findForbiddenMoves', () => {
  it('flags a removed assertion in a test file', () => {
    const diff = fileDiff('__tests__/badge.test.ts', ['   it("x", () => {', '-    expect(fmt(d)).toBe("30 Apr");', '   });']);
    expect(moves(diff)).toEqual(['removed-assertion']);
  });

  it('a rewritten assertion (one out, one in) is not a removal', () => {
    const diff = fileDiff('__tests__/badge.test.ts', ['-    expect(fmt(d)).toBe("30 Apr");', '+    expect(fmt(d)).toBe("30 Apr 2026");']);
    expect(moves(diff)).toEqual([]);
  });

  it('a deleted test file with assertions is a removal', () => {
    const diff = fileDiff('__tests__/old.test.tsx', ['-it("x", () => { expect(1).toBe(1) })'], { deleted: true });
    expect(moves(diff)).toEqual(['removed-assertion']);
  });

  it('an assertion removed from source code is not a test weakening', () => {
    expect(moves(fileDiff('lib/x.ts', ['-  assert(ok)']))).toEqual([]);
  });

  it('flags an added .skip, .only, .todo, xit and skipIf', () => {
    for (const line of ['+it.skip("x", () => {})', '+describe.only("x", () => {})', '+it.todo("x")', '+xit("x", () => {})', '+it.skipIf(ci)("x", () => {})', '+test.fixme("x", async () => {})']) {
      expect(moves(fileDiff('tests/e2e/a.spec.ts', [line]))).toEqual(['skip-only']);
    }
  });

  it('a skip or timeout quoted in a string is not one', () => {
    expect(moves(fileDiff('__tests__/a.test.ts', ["+  const fixture = '+it.skip(\"x\")'", "+  const t = 'vi.setConfig({ testTimeout: 30_000 })'"]))).toEqual([]);
  });

  it('a gate file is reported as edit-gate-scripts, not as a push', () => {
    expect(moves(fileDiff('scripts/lib/forbiddenMoves.mjs', ['+const P = /git push/']))).toEqual(['edit-gate-scripts']);
  });

  it('flags a raised timeout, not a lowered one', () => {
    expect(moves(fileDiff('__tests__/a.test.tsx', ['-  it("x", run, 5000)', '+  it("x", run, 20000)']))).toEqual(['timeout-raised']);
    expect(moves(fileDiff('__tests__/a.test.tsx', ['+  vi.setConfig({ testTimeout: 30_000 })']))).toEqual(['timeout-raised']);
    expect(moves(fileDiff('__tests__/a.test.tsx', ['-  { timeout: 9000 }', '+  { timeout: 3000 }']))).toEqual([]);
  });

  it('flags a new knownFlakes entry but not a removed one', () => {
    const before = '[]';
    const after = '[{"file":"__tests__/x.test.tsx","reason":"r","since":"2026-10-14"}]';
    const diff = fileDiff('config/knownFlakes.json', ['-[]', `+${after}`]);
    expect(moves(diff, { before: () => before, after: () => after })).toEqual(['flake-listed']);
    expect(moves(diff, { before: () => after, after: () => before })).toEqual([]);
  });

  it('flags a grown eslint suppression baseline but not a pruned one', () => {
    const small = JSON.stringify({ 'a.tsx': { 'jsx-a11y/label-has-associated-control': { count: 1 } } });
    const big = JSON.stringify({ 'a.tsx': { 'jsx-a11y/label-has-associated-control': { count: 2 } } });
    const diff = fileDiff('eslint-suppressions.json', ['-x', '+y']);
    expect(moves(diff, { before: () => small, after: () => big })).toEqual(['suppression-added']);
    expect(moves(diff, { before: () => big, after: () => small })).toEqual([]);
  });

  it('flags an edit to the gate itself and to test config', () => {
    expect(moves(fileDiff('scripts/gate.mjs', ['+// x']))).toEqual(['edit-gate-scripts']);
    expect(moves(fileDiff('.github/workflows/ci.yml', ['+x']))).toEqual(['edit-gate-scripts']);
    expect(moves(fileDiff('vitest.config.ts', ['+x']))).toEqual(['edit-test-config']);
  });

  it('flags a script that pushes or targets the tenant', () => {
    expect(moves(fileDiff('package.json', ['+    "ship": "git push origin main"']))).toEqual(['deploy-or-push']);
    expect(moves(fileDiff('scripts/x.mjs', ['+run("node supabase/migrate.mjs --env=amadiya")']))).toEqual(['deploy-or-push']);
    expect(moves(fileDiff('docs/claude/gate.md', ['+git push -u origin <branch>']))).toEqual([]);
  });

  it('every move it can report is a known move', () => {
    expect(MOVES).toEqual(expect.arrayContaining(['removed-assertion', 'skip-only', 'timeout-raised', 'flake-listed', 'suppression-added', 'edit-gate-scripts', 'edit-test-config', 'deploy-or-push']));
  });
});

describe('applyAllowances', () => {
  const found = [{ move: 'edit-gate-scripts', file: 'scripts/gate.mjs', detail: 'x' }];
  const allow = [{ move: 'edit-gate-scripts', reason: 'the gate is the deliverable' }];

  it('an allowance in the approved brief excuses the move', () => {
    expect(applyAllowances(found, { atApproval: allow, atTip: allow })).toEqual([
      { ...found[0], blocking: false, allowedBecause: 'the gate is the deliverable' },
    ]);
  });

  it('an allowance added after the code excuses nothing', () => {
    expect(applyAllowances(found, { atApproval: [], atTip: allow })).toEqual([
      { ...found[0], blocking: true, note: 'allowance added after approval — excuses nothing' },
    ]);
  });

  it('no allowance blocks', () => {
    expect(applyAllowances(found, { atApproval: [], atTip: [] })).toEqual([{ ...found[0], blocking: true }]);
  });
});

describe('touchesCode', () => {
  it('a docs-only diff touches no code', () => {
    expect(touchesCode(['docs/claude/gate.md', 'README.md', 'docs/PRODUCT_SPEC.html', '.claude/agents/gate.md', 'docs/img/x.png'])).toEqual([]);
  });

  it('anything else is code', () => {
    expect(touchesCode(['docs/x.md', 'lib/a.ts', '.claude/settings.json', 'package.json'])).toEqual(['lib/a.ts', '.claude/settings.json', 'package.json']);
  });
});
