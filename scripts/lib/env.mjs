// scripts/lib/env.mjs
//
// One target resolver for every script that talks to a Supabase project.
// Replaces the five copy-pasted `loadEnv()` implementations that each ended in
// `|| 'lsgkznyiabqitqfpveey'` — a default that turned "I forgot to say which
// environment" into "I wrote to the demo database" without a word of output.
//
// There is no default here and there is no `--force`. A script either names its
// target or it exits.
//
// See PRODUCTION-LAUNCH-PLAN.md §A1.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ENV_NAMES, getEnvironment, isProvisioned } from '../../config/environments.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..', '..') // NexOrder/

export class TargetError extends Error {}

/**
 * Parse a dotenv-style file. Values may be single- or double-quoted.
 * @param {string} absPath
 * @returns {Record<string,string>}
 */
export function parseEnvFile(absPath) {
  /** @type {Record<string,string>} */
  const out = {}
  if (!existsSync(absPath)) return out
  for (const line of readFileSync(absPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

/**
 * Read the target name from argv / the environment. Never guesses.
 *
 * EQUALS FORM ONLY. `--env prod` is rejected rather than tolerated, because
 * `supabase/apply-sql.mjs` picks its SQL file as the first non-`--` argument —
 * a space-separated value would be silently consumed as a filename and the
 * target would fall through to whatever came next. Failing loudly on the
 * ambiguous spelling is cheaper than explaining that bug twice.
 *
 * @param {string[]} argv
 * @returns {string}
 */
export function readTargetName(argv) {
  const bare = argv.find((a) => a === '--env' || a === '-e')
  if (bare) {
    throw new TargetError(
      `Use the equals form: --env=<${ENV_NAMES.join('|')}>. ` +
        `"${bare} <value>" is rejected because the value can be mistaken for a filename.`,
    )
  }

  const flag = argv.find((a) => a.startsWith('--env='))
  if (flag) return flag.slice('--env='.length).trim()

  const fromEnv = (process.env.NEXORDER_ENV ?? '').trim()
  if (fromEnv) return fromEnv

  throw new TargetError(
    `No target environment. Pass --env=<${ENV_NAMES.join('|')}> or set NEXORDER_ENV.\n` +
      `There is no default — naming the target is the point.`,
  )
}

/**
 * Resolve the target environment and load its credentials.
 *
 * @param {object} [options]
 * @param {string[]} [options.allow]  Whitelist of permitted target names. A
 *   script that must never touch production passes `{ allow: ['dev'] }` and
 *   exits before any I/O happens.
 * @param {string[]} [options.argv]   Defaults to process.argv.slice(2).
 * @param {string[]} [options.require] Credential names that must be present.
 * @returns {{ name: string, config: any, env: Record<string,string> }}
 */
export function resolveTarget(options = {}) {
  const argv = options.argv ?? process.argv.slice(2)
  const name = readTargetName(argv)
  const config = getEnvironment(name)

  if (options.allow && !options.allow.includes(name)) {
    throw new TargetError(
      `This script may only run against: ${options.allow.join(', ')}. Refusing "${name}".\n` +
        `This is not overridable. If you believe it should run here, the script is wrong, not the guard.`,
    )
  }

  if (!isProvisioned(config)) {
    throw new TargetError(
      `Environment "${name}" has no project ref yet.\n` +
        `Create the project (PRODUCTION-LAUNCH-PLAN.md §A0.3) and fill projectRef/supabaseUrl ` +
        `into config/environments.mjs before targeting it.`,
    )
  }

  // process.env wins over the file, so CI can inject without rewriting files.
  // The assertion below is what stops that from becoming a foot-gun.
  const fromFile = parseEnvFile(resolve(ROOT, config.envFile))
  /** @type {Record<string,string>} */
  const env = { ...fromFile }
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v !== '') env[k] = v
  }

  assertCredentialsMatch(name, config, env)

  for (const key of options.require ?? []) {
    if (!env[key]) {
      throw new TargetError(
        `Missing ${key} for target "${name}". Set it in ${config.envFile} or the environment.`,
      )
    }
  }

  return { name, config, env }
}

/**
 * Guard #2 of the three fixture guards: the credentials actually loaded must
 * belong to the environment that was named. Catches prod credentials pasted
 * into the dev file, a stale `.env.local` exported in the shell, and a
 * copy-paste of the wrong project out of the Supabase dashboard.
 */
function assertCredentialsMatch(name, config, env) {
  const mismatches = []

  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  if (url && url.replace(/\/+$/, '') !== config.supabaseUrl) {
    mismatches.push(`  VITE_SUPABASE_URL is ${url}\n    expected ${config.supabaseUrl}`)
  }

  const ref = env.SUPABASE_PROJECT_REF
  if (ref && ref !== config.projectRef) {
    mismatches.push(`  SUPABASE_PROJECT_REF is ${ref}\n    expected ${config.projectRef}`)
  }

  if (mismatches.length) {
    throw new TargetError(
      `Credentials loaded for "${name}" do not belong to that environment:\n` +
        `${mismatches.join('\n')}\n` +
        `Check ${config.envFile}, and check for a stale export in your shell.`,
    )
  }
}

/**
 * Wrapper for top-level script use: prints the message without a stack trace
 * and exits 1. A wall of Node internals buries the one line that matters.
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function orExit(fn) {
  try {
    return fn()
  } catch (e) {
    if (e instanceof TargetError) {
      console.error(`\n${e.message}\n`)
      process.exit(1)
    }
    throw e
  }
}
