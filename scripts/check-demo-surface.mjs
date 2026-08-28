#!/usr/bin/env node
// Assert, on the BUILT ARTIFACT, that demo credentials ship to the demo host
// and to no one else.
//
//   node scripts/check-demo-surface.mjs
//
// The login page can render a click-to-fill roster of seven working accounts,
// one of them an Admin, together with their shared password. Whether it does is
// decided by `__DEMO_HOST__`, folded from `kind` in config/environments.mjs.
//
// Why this exists as a separate check rather than trust in the fold:
//
//   1. It is a FOLD. Nothing in a type-check or a unit test can tell you
//      whether Rollup actually dropped the branch; only the output can. The
//      previous mechanism (VITE_SHOW_DEMO_LOGINS, read as `!== 'false'`) was an
//      opt-out env var living in a Vercel dashboard, and it failed exactly the
//      way an unasserted thing fails: nexorder.com.au served a paying client an
//      Admin login and its password. SECURITY-AUDIT-2026-08-19.md names the
//      gap in as many words -- "no check that VITE_SHOW_DEMO_LOGINS=false for a
//      tenant build".
//   2. CI has never built a tenant target at all. `npm run build` in ci.yml
//      runs with no NEXORDER_ENV, so it always builds `dev` with every module
//      on. Amadiya's module-folded bundle is, until this script, compiled for
//      the first time by the deploy that ships it.
//
// It checks BOTH DIRECTIONS on purpose. A tenant-only check would pass forever
// if the roster silently vanished from the demo too, which is a real failure --
// the demo exists to be looked at.
//
// The needles are READ OUT OF THE SOURCE, not hardcoded. A hardcoded password
// would still pass this check on the day someone changes it, which is the one
// day you would want it to fail. If the extraction finds nothing the script
// errors rather than passing vacuously.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { TARGETS, isProvisioned } from '../config/environments.mjs'
import { ROOT } from './lib/env.mjs'

const LOGIN_PAGE = resolve(ROOT, 'components/auth/LoginPage.tsx')

// The ONE target allowed to ship demo credentials, stated as a literal and
// derived from nothing.
//
// This independence is the entire point, and it was added after the first
// version of this script failed its own negative test. That version took the
// expectation from `kind`, the same field that drives the fold -- so flipping
// amadiya to `kind: 'demo'` changed the build AND the expectation together and
// the check happily approved shipping an Admin password to a paying client. A
// check whose expectation moves with the thing it is checking asserts nothing.
//
// Same reasoning as fixture guard #3 (scripts/lib/fixtureGuard.mjs), which
// compares against the literal 'dev' and reads nothing from the registry.
// Adding a second demo deployment means editing this line, on purpose.
const DEMO_TARGETS = new Set(['dev'])

/**
 * Pull the demo password and account emails out of LoginPage.tsx.
 *
 * Deliberately strict: an empty result is a hard error. The whole value of this
 * check is that it knows what to look for, and a silently-empty needle list
 * turns it into a green tick that asserts nothing.
 */
function demoNeedles() {
  const src = readFileSync(LOGIN_PAGE, 'utf8')

  const password = (src.match(/const DEMO_PASSWORD\s*=\s*[^?]*\?\s*'([^']+)'/) ?? [])[1]
  const emails = [...src.matchAll(/email:\s*'([^']+)'/g)].map((m) => m[1])

  const problems = []
  if (!password) problems.push('could not find the DEMO_PASSWORD literal')
  if (emails.length === 0) problems.push('could not find any DEMO_ACCOUNTS email literals')
  if (problems.length) {
    console.error(
      `[check-demo-surface] cannot read the demo credentials out of ${LOGIN_PAGE}:\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nThis script greps the built bundle for those exact strings. If the shape\n' +
        'of that file changed, update the patterns here -- do not delete the check.\n',
    )
    process.exit(1)
  }
  return [password, ...emails]
}

/** Every file under `dir`, recursively. */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

/** Which of `needles` appear anywhere in the build output at `dir`. */
function needlesPresent(dir, needles) {
  const found = new Set()
  for (const file of walk(dir)) {
    // Fonts and images cannot contain a credential and are most of the bytes.
    if (/\.(woff2?|png|jpe?g|gif|svg|ico|webp)$/i.test(file)) continue
    const text = readFileSync(file, 'latin1')
    for (const n of needles) if (!found.has(n) && text.includes(n)) found.add(n)
    if (found.size === needles.length) break
  }
  return found
}

const needles = demoNeedles()
const outRoot = mkdtempSync(join(tmpdir(), 'nexorder-demo-surface-'))
const problems = []

try {
  for (const [name, target] of Object.entries(TARGETS)) {
    if (!isProvisioned(target)) continue

    const outDir = join(outRoot, name)
    // Its own outDir, never the shared dist/: ci.yml runs `npm run build` as a
    // separate step and this must not hand that step a tenant bundle.
    // Vite's JS entry run by the current node binary, rather than `npx` or
    // `shell: true`. On Windows the launcher is `npx.cmd`, and node 24 refuses
    // to spawnSync a .cmd (EINVAL) while `shell: true` with an args array is
    // deprecated (DEP0190). This form has neither problem and no quoting.
    execFileSync(
      process.execPath,
      [
        resolve(ROOT, 'node_modules/vite/bin/vite.js'),
        'build',
        '--outDir',
        outDir,
        '--emptyOutDir',
        '--logLevel',
        'error',
      ],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          NEXORDER_ENV: name,
          // vite.config.ts needs no credentials to build, but lib/supabase.ts
          // throws at module scope on an EMPTY url. Same offline placeholder
          // vitest.config.ts uses, so the host is greppable and unreachable.
          VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://testref.supabase.co',
          VITE_SUPABASE_ANON_KEY:
            process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_offline_check',
        },
      },
    )

    const found = needlesPresent(outDir, needles)
    const shouldShip = DEMO_TARGETS.has(name)

    // Two independent statements about the same target: this script's literal,
    // and the registry field that drives the fold. They must agree. If they do
    // not, one of them is a mistake and neither can be trusted to say which --
    // so this is an error in its own right, not a silent preference for one.
    if (shouldShip !== (target.kind === 'demo')) {
      problems.push(
        `${name}: this script lists it as ${shouldShip ? '' : 'NOT '}a demo target, but the ` +
          `registry says kind '${target.kind}'. Resolve the disagreement before trusting ` +
          `either. If ${name} really is a new demo deployment, add it to DEMO_TARGETS here.`,
      )
    }

    if (shouldShip && found.size !== needles.length) {
      const missing = needles.filter((n) => !found.has(n))
      problems.push(
        `${name} (kind '${target.kind}') is the demo and should carry the account roster, ` +
          `but ${missing.length} of ${needles.length} credentials are missing from the bundle ` +
          `(e.g. ${JSON.stringify(missing[0])}). The demo exists to be looked at; a demo with ` +
          `no way in is as broken as a tenant with credentials.`,
      )
    }
    if (!shouldShip && found.size > 0) {
      problems.push(
        `${name} (kind '${target.kind}') is not a demo target and its bundle contains ` +
          `${found.size} demo credential(s): ${[...found].map((f) => JSON.stringify(f)).join(', ')}. ` +
          `Anyone loading ${target.appOrigin ?? 'the site'} can read them. Check that ` +
          `__DEMO_HOST__ still gates the DATA in LoginPage.tsx and not only the JSX -- ` +
          `dropping an unreferenced array relies on tree-shaking, folding a ternary does not.`,
      )
    }

    console.log(
      `[check-demo-surface] ${name}: OK (kind '${target.kind}', ` +
        `${found.size}/${needles.length} demo credentials in the bundle, ` +
        `expected ${shouldShip ? 'all' : 'none'}).`,
    )
  }
} finally {
  rmSync(outRoot, { recursive: true, force: true })
}

if (problems.length) {
  console.error('\n[check-demo-surface] the built bundles are wrong:\n')
  for (const p of problems) console.error(`  - ${p}\n`)
  process.exit(1)
}

console.log(
  '[check-demo-surface] OK — demo credentials ship to the demo host and to no one else.',
)
