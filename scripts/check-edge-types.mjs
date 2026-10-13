#!/usr/bin/env node
// Edge Function type-check.
//
// `supabase/functions` is excluded from `npx tsc --noEmit` (Deno imports, URL
// specifiers), and nothing on the frontend imports a function, so before this
// guard the 83 entrypoints were type-checked by NOTHING. That is not academic:
// the `_shared/` helpers take all-optional ("weak") parameter types, and
// `approve-po`'s `PendingPoRow` broke at runtime having looked fine everywhere
// else. `deno check` is the compiler the functions actually run under.
//
// This guard is ABSOLUTE — there is no baseline file. When it was introduced
// (2026-10-13) every entrypoint already passed, so the clean state is the
// starting state; keep it that way rather than adding an exemption list.
//
// `--node-modules-dir=none` is load-bearing: without it Deno sees the repo's
// package.json, switches to "manual" node_modules resolution and fails every
// `npm:` specifier (mammoth, in extract-po) that the FRONTEND does not install.
// The deployed runtime resolves those from its own cache; so must the check.
//
// Usage: node scripts/check-edge-types.mjs [function-name ...]
//   Uses `deno` from PATH (CI installs it), else `npx --yes deno@<pinned>`.

import { readdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep in step with `deno-version` in .github/workflows/ci.yml.
export const DENO_VERSION = '2.9.6'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions')

function entrypoints(only) {
  const names = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((name) => existsSync(join(FUNCTIONS_DIR, name, 'index.ts')))
  const unknown = only.filter((name) => !names.includes(name))
  if (unknown.length > 0) {
    console.error(`check-edge-types: no such function: ${unknown.join(', ')}`)
    process.exit(2)
  }
  const chosen = only.length > 0 ? only : names
  return chosen.map((name) => join('supabase', 'functions', name, 'index.ts'))
}

// Windows can only launch `npx.cmd` through a shell, and Node deprecates
// passing an args array alongside `shell: true` (DEP0190), so join into one
// command string. Every argument is a repo-relative path with no spaces.
function run(argv, options = {}) {
  if (process.platform === 'win32') return spawnSync(argv.join(' '), { ...options, shell: true })
  return spawnSync(argv[0], argv.slice(1), options)
}

function denoCommand() {
  const probe = run(['deno', '--version'], { stdio: 'ignore' })
  if (probe.status === 0) return ['deno']
  return ['npx', '--yes', `deno@${DENO_VERSION}`]
}

const files = entrypoints(process.argv.slice(2))
const deno = denoCommand()
console.log(`check-edge-types: deno check on ${files.length} function(s) via ${deno.join(' ')}`)

const result = run([...deno, 'check', '--node-modules-dir=none', ...files], { cwd: ROOT, stdio: 'inherit' })

if (result.status !== 0) {
  console.error('\ncheck-edge-types: FAILED — fix the type errors above; there is no baseline to add them to.')
  process.exit(result.status ?? 1)
}
console.log(`check-edge-types: ${files.length} function(s) clean.`)
