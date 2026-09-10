#!/usr/bin/env node
/**
 * CLAUDE.md is loaded into every Claude Code session and the harness refuses it past
 * 150k chars — at which point the guardrails it exists to enforce (the two-workspace
 * wall, the two-database wall, the lockdown table) are the first thing lost.
 *
 * It hit 173k on 2026-09-10 and was split: the argued detail moved verbatim into
 * docs/claude/, and only the rules that must hold unread stayed inline. This guard
 * exists because that split is undone one useful paragraph at a time.
 *
 * Counting is in CHARACTERS, not bytes — that is what the harness measures, and this
 * file is full of em dashes and box-drawing, so the two differ by ~1%.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HARD_LIMIT = 150_000; // the harness refuses above this
const SOFT_LIMIT = 120_000; // move detail out before it becomes urgent

const text = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
const chars = text.length;
const pct = ((100 * chars) / HARD_LIMIT).toFixed(1);

/** Top-level `## ` sections, largest first. */
function sections() {
  const out = [];
  let name = '(preamble)';
  let size = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      out.push({ name, size });
      name = line.slice(3).trim();
      size = 0;
    }
    size += line.length + 1;
  }
  out.push({ name, size });
  return out.sort((a, b) => b.size - a.size);
}

function report() {
  console.log('\n  Largest sections:');
  for (const s of sections().slice(0, 5)) {
    console.log(`    ${String(s.size).padStart(7)}  ${s.name}`);
  }
  console.log('\n  Move detail into docs/claude/ and leave behind only the rule that must');
  console.log('  hold if nobody opens the doc. See "Where the detail lives" in CLAUDE.md.\n');
}

if (chars > HARD_LIMIT) {
  console.error(`FAIL  CLAUDE.md is ${chars.toLocaleString()} chars — over the ${HARD_LIMIT.toLocaleString()} limit (${pct}%).`);
  console.error('      Claude Code will not load it, so none of it is enforcing anything.');
  report();
  process.exit(1);
}

if (chars > SOFT_LIMIT) {
  console.warn(`WARN  CLAUDE.md is ${chars.toLocaleString()} chars — ${pct}% of the ${HARD_LIMIT.toLocaleString()} limit.`);
  report();
  process.exit(0);
}

console.log(`ok  CLAUDE.md is ${chars.toLocaleString()} chars (${pct}% of the ${HARD_LIMIT.toLocaleString()} limit).`);
