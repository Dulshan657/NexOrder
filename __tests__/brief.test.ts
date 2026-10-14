import { describe, it, expect } from 'vitest';
import { briefBody, checkFinal, parseBrief, parseFinal } from '../scripts/lib/brief.mjs';

const BASE = 'b8a539e7d1890233addab2ace240c7f8b027a898';

const header = (over: Record<string, unknown> = {}) => ({
  id: 'NX-0002-some-fix',
  base: BASE,
  approved: '2026-10-14 owner',
  acceptance: [
    { id: 'A1', check: 'the badge formats in en-AU' },
    { id: 'A2', check: 'deployed to dev', manual: 'version.json' },
  ],
  failFirst: [{ file: '__tests__/badge.test.ts', test: 'badge > formats en-AU', proves: ['A1'] }],
  ...over,
});

const md = (h: unknown, final = '') =>
  `# NX-0002\n\n\`\`\`json brief\n${JSON.stringify(h, null, 2)}\n\`\`\`\n\n## Goal\n\nx\n\n## FINAL\n${final}`;

describe('parseBrief', () => {
  it('accepts a well-formed brief and defaults allow to []', () => {
    const { brief, errors } = parseBrief(md(header()));
    expect(errors).toEqual([]);
    expect(brief.id).toBe('NX-0002-some-fix');
    expect(brief.allow).toEqual([]);
  });

  it('refuses an unknown key', () => {
    expect(parseBrief(md(header({ approvedBy: 'me' }))).errors).toContain('unknown key "approvedBy"');
  });

  it('refuses a missing header block', () => {
    expect(parseBrief('# nothing here').errors[0]).toMatch(/no ```json brief``` block/);
  });

  it('refuses invalid JSON with the parser message', () => {
    expect(parseBrief('```json brief\n{ nope }\n```').errors[0]).toMatch(/not valid JSON/);
  });

  it('refuses a missing required field', () => {
    const { approved: _, ...rest } = header();
    expect(parseBrief(md(rest)).errors).toContain('missing "approved"');
  });

  it('refuses a malformed id or a short base', () => {
    const { errors } = parseBrief(md(header({ id: 'fix-thing', base: 'b8a539e' })));
    expect(errors).toContain('id must look like NX-0001-some-slug');
    expect(errors).toContain('base must be a full 40-character commit sha');
  });

  it('refuses a duplicate acceptance id', () => {
    const acceptance = [{ id: 'A1', check: 'x' }, { id: 'A1', check: 'y', manual: 'z' }];
    expect(parseBrief(md(header({ acceptance }))).errors).toContain('duplicate acceptance id A1');
  });

  it('refuses a proves naming no acceptance id', () => {
    const failFirst = [{ file: '__tests__/badge.test.ts', test: 'badge > x', proves: ['A9'] }];
    expect(parseBrief(md(header({ failFirst }))).errors).toContain('failFirst "badge > x" proves A9, which is not an acceptance id');
  });

  it('refuses an acceptance check nothing proves and nobody verifies by hand', () => {
    const acceptance = [{ id: 'A1', check: 'x' }, { id: 'A2', check: 'y' }];
    expect(parseBrief(md(header({ acceptance }))).errors).toContain('A2 is proved by no failFirst test and has no "manual" note');
  });

  it('refuses a failFirst file that is not a unit test', () => {
    const failFirst = [{ file: 'components/Badge.tsx', test: 'x', proves: ['A1'] }];
    expect(parseBrief(md(header({ failFirst }))).errors).toContain('failFirst file components/Badge.tsx is not a *.test.ts(x) file');
  });

  it('refuses an allowance for an unknown move, or without a reason', () => {
    const { errors } = parseBrief(md(header({ allow: [{ move: 'yolo', reason: 'x' }, { move: 'skip-only', reason: ' ' }] })));
    expect(errors).toContain('allow: unknown move "yolo"');
    expect(errors).toContain('allow: "skip-only" needs a reason');
  });
});

describe('briefBody', () => {
  it('is everything before ## FINAL, so writing FINAL is not a revision', () => {
    const a = md(header());
    const b = md(header(), '\n| A1 | claimed | x | |\n');
    expect(briefBody(a)).toBe(briefBody(b));
    expect(briefBody(a)).not.toContain('## FINAL');
  });
});

const finalTable = (rows: string[], notClaimed = ['- No browser run.']) =>
  ['', '| Acceptance | Status | Evidence | Note |', '|---|---|---|---|', ...rows, '', '### Not claimed', '', ...notClaimed, ''].join('\n');

describe('parseFinal', () => {
  it('reads rows and the not-claimed list', () => {
    const f = parseFinal(md(header(), finalTable(['| A1 | claimed | `badge > formats en-AU` | |', '| A2 | not-claimed | | dev only |'])));
    expect(f.present).toBe(true);
    expect(f.rows).toEqual([
      { id: 'A1', status: 'claimed', evidence: '`badge > formats en-AU`', note: '' },
      { id: 'A2', status: 'not-claimed', evidence: '', note: 'dev only' },
    ]);
    expect(f.notClaimed).toEqual(['No browser run.']);
  });

  it('an empty FINAL is not present', () => {
    expect(parseFinal(md(header())).present).toBe(false);
  });
});

describe('checkFinal', () => {
  const { brief } = parseBrief(md(header()));

  it('accepts a FINAL that accounts for every acceptance id', () => {
    const f = parseFinal(md(header(), finalTable(['| A1 | claimed | `badge > formats en-AU` | |', '| A2 | claimed | /version.json = abc | |'])));
    expect(checkFinal(brief, f)).toEqual([]);
  });

  it('refuses an empty FINAL', () => {
    expect(checkFinal(brief, parseFinal(md(header())))).toEqual(['FINAL is empty — write it before asking for the gate']);
  });

  it('refuses a FINAL missing an acceptance id', () => {
    const f = parseFinal(md(header(), finalTable(['| A1 | claimed | `badge > formats en-AU` | |'])));
    expect(checkFinal(brief, f)).toContain('FINAL does not account for A2');
  });

  it('refuses a claim without evidence', () => {
    const f = parseFinal(md(header(), finalTable(['| A1 | claimed | | |', '| A2 | not-claimed | | |'])));
    expect(checkFinal(brief, f)).toContain('A1 is claimed with no evidence');
  });

  it('refuses an unknown status, an unknown id and a duplicate row', () => {
    const f = parseFinal(md(header(), finalTable(['| A1 | done | x | |', '| A1 | claimed | x | |', '| A2 | claimed | y | |', '| A7 | claimed | z | |'])));
    const errors = checkFinal(brief, f);
    expect(errors).toContain('A1: status must be claimed or not-claimed, got "done"');
    expect(errors).toContain('A1 appears twice in FINAL');
    expect(errors).toContain('FINAL names A7, which is not an acceptance id');
  });

  it('refuses a FINAL with no Not claimed list', () => {
    const f = parseFinal(md(header(), finalTable(['| A1 | claimed | x | |', '| A2 | claimed | y | |'], [])));
    expect(checkFinal(brief, f)).toContain('FINAL needs a "### Not claimed" list with at least one item');
  });
});
