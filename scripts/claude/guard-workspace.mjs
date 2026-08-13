#!/usr/bin/env node
// PreToolUse guard: refuse tenant-targeting shell commands in a dev workspace.
//
// Wired from .claude/settings.json as a PreToolUse hook on Bash|PowerShell.
// Reads the hook payload on stdin and answers with a permissionDecision.
//
// ── WHY THIS EXISTS AND NOT JUST A DENY RULE ────────────────────────────────
//
// Claude Code permission rules match by PREFIX — `Bash(npm run deploy:*)`.
// Every dangerous command here is dangerous because of something in its
// MIDDLE: `node supabase/migrate.mjs --env=amadiya`. A prefix rule cannot see
// it, so the deny list in settings.json catches the npm aliases and this
// catches the rest. Both are still only a speed bump; the actual wall is that
// `.env.amadiya.local` does not exist in this checkout (scripts/lib/env.mjs
// `assertEnvFilePresent`). Defence in depth, in that order of strength.
//
// ── WHICH WORKSPACE AM I ────────────────────────────────────────────────────
//
// Derived, never hardcoded: a checkout is a tenant workspace if it holds the
// env file of a `kind: 'tenant'` target. So the tenant worktree runs the same
// hook and is unaffected by it, and nothing has to be kept in sync by hand.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TARGETS } from '../../config/environments.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const TENANTS = Object.values(TARGETS).filter((t) => t.kind === 'tenant')

/** Does this checkout carry any tenant's credentials? Then it IS that workspace. */
const isTenantWorkspace = TENANTS.some((t) => existsSync(resolve(ROOT, t.envFile)))

/**
 * Patterns that mean "this command is aimed at a tenant".
 *
 * `--env=prod` is included because `DEPRECATED_TARGET_ALIASES` still resolves
 * it to amadiya, which is exactly the stale-runbook case it was kept for.
 */
function tenantPatterns() {
  const names = TENANTS.map((t) => t.name)
  const refs = TENANTS.map((t) => t.projectRef).filter(Boolean)
  const files = TENANTS.map((t) => t.envFile)
  return [
    ...names.map((n) => ({
      re: new RegExp(`--env\\s*[= ]\\s*${n}\\b`, 'i'),
      what: `--env=${n}`,
    })),
    { re: /--env\s*[= ]\s*prod\b/i, what: '--env=prod (an alias for a tenant)' },
    ...names.map((n) => ({
      re: new RegExp(`\\bnpm\\s+run\\s+\\S*:${n}\\b`, 'i'),
      what: `an npm script targeting ${n}`,
    })),
    ...refs.map((r) => ({ re: new RegExp(r), what: `a tenant project ref (${r})` })),
    ...files.map((f) => ({
      re: new RegExp(f.replace(/\./g, '\\.')),
      what: `a tenant credential file (${f})`,
    })),
  ]
}

/**
 * Only a segment that actually INVOKES something can target a tenant.
 *
 * The first version of this matched the whole command string, and the first
 * thing it blocked was `git commit -m "...--env=amadiya..."` — a commit message
 * describing the guard itself. That is the whole false-positive class: commit
 * messages, `echo`, `rg`, doc edits and this very file all contain the
 * dangerous spellings as CONTENT rather than as arguments to a runner.
 *
 * So: split on shell separators, take each segment's leading token, and only
 * judge segments whose leading token is something that runs project code.
 * `cd x && npm run migrate:amadiya` is still caught (segment two leads with
 * `npm`); `git commit -m "…"` is not (it leads with `git`).
 */
const RUNNERS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'bun', 'node', 'deno', 'supabase', 'vercel'])

/**
 * Blank out shell-quoted spans. Quoted text is an argument VALUE, not command
 * structure, and treating it as structure is what produced both false
 * positives found while building this:
 *
 *   git commit -m "...`cd x && npm run migrate:<tenant>`..."
 *
 * splits on the `&&` INSIDE the message, and the fragment that falls out leads
 * with `npm`. No amount of leading-token cleverness fixes that while the quotes
 * are invisible — a commit message about the guard has to be able to quote the
 * commands the guard blocks.
 *
 * KNOWN GAP, accepted deliberately: `node x.mjs --env="<tenant>"` is masked
 * too, so this hook misses it. Every real invocation writes the value bare, the
 * cost of the alternative is a guard that blocks writing about itself, and the
 * absent credential file catches the quoted spelling anyway. Pinned by a test
 * so it stays a decision rather than becoming a surprise.
 */
function maskQuoted(command) {
  let out = ''
  let quote = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
      out += c === '\n' ? '\n' : ' '
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      out += ' '
      continue
    }
    out += c
  }
  return out
}

function invokingSegments(command) {
  // NEWLINES separate too. Without that a multi-line script collapses into a
  // few enormous segments and the leading-token test stops meaning anything —
  // one runner anywhere near the top would judge fifty unrelated lines.
  return maskQuoted(command)
    .split(/&&|\|\||[;|\r\n]/)
    .map((s) => s.trim())
    .filter((s) => {
      const lead = s.split(/\s+/)[0]?.replace(/\.exe$/i, '')
      return RUNNERS.has(lead)
    })
}

/**
 * Bare CLI invocations that bypass resolveTarget() entirely.
 *
 * `npx supabase ...` without `--project-ref` uses whatever
 * supabase/.temp/linked-project.json names, and `vercel ...` uses whatever
 * .vercel/project.json names — two files that no `--env` flag can influence.
 * Both were pointed at Amadiya on this machine until 2026-08-13. Every
 * legitimate use goes through an npm script, which spawns the CLI itself and
 * so is never seen by this hook.
 */
const BARE_CLI = [
  {
    re: /(^|[;&|]\s*|\bnpx\s+)supabase(\s|$)/i,
    skipIf: /--project-ref/,
    what: 'a bare `supabase` CLI call',
    why: 'it targets whatever supabase/.temp/linked-project.json names, which no --env flag can change',
  },
  {
    re: /(^|[;&|]\s*|\bnpx\s+)vercel(\s|$)/i,
    skipIf: /--scope|VERCEL_PROJECT_ID/,
    what: 'a bare `vercel` CLI call',
    why: 'it targets whatever .vercel/project.json names, and the CLI login is not this repo’s to choose',
  },
]

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  )
  process.exit(0)
}

function main(payload) {
  const command = payload?.tool_input?.command
  if (typeof command !== 'string' || !command.trim()) return

  const segments = invokingSegments(command)
  if (!segments.length) return

  for (const { re, skipIf, what, why } of BARE_CLI) {
    if (segments.some((s) => re.test(s) && !(skipIf && skipIf.test(s)))) {
      deny(
        `Blocked ${what}: ${why}. Use the npm script for the environment you mean ` +
          `(they thread the project and the token from config/environments.mjs), or ` +
          `pass an explicit --project-ref/--scope if you genuinely need the raw CLI.`,
      )
    }
  }

  if (isTenantWorkspace) return // this checkout IS the tenant workspace

  for (const { re, what } of tenantPatterns()) {
    if (segments.some((s) => re.test(s))) {
      const where = TENANTS.map((t) => t.name).join(', ')
      deny(
        `Blocked: this command names ${what}, and this checkout is the DEVELOPMENT ` +
          `workspace — it holds no tenant credentials and is where code is edited.\n` +
          `Tenant operations (${where}) run from the tenant's own checkout, which is ` +
          `the only place their .env file exists. Open a session there instead.\n` +
          `If you are deliberately changing how a tenant script WORKS, edit the script ` +
          `here — that is fine; only RUNNING it against a tenant is blocked.`,
      )
    }
  }
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => {
  raw += c
})
process.stdin.on('end', () => {
  try {
    main(JSON.parse(raw || '{}'))
  } catch {
    // A guard that crashes must not block every command in the session. It
    // fails OPEN on its own bugs and CLOSED on the patterns it understands —
    // the same call publishReadiness makes, and the opposite of what a
    // security control would do. This is a workspace convenience, not a
    // security boundary; the boundary is the absent credential file.
  }
})
