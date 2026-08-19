// Run the O6 session soak in twelve minutes instead of ninety.
//
//   npm run soak:session:dev
//   node scripts/session-soak.mjs --env=dev --cycles=3
//
// ── WHAT THIS DOES AND WHY IT IS SAFE ───────────────────────────────────────
//
// supabase-js renews a token when it expires within 90 seconds
// (`AUTO_REFRESH_TICK_THRESHOLD × AUTO_REFRESH_TICK_DURATION_MS`). So how long
// a soak takes is set by ONE project setting — `jwt_exp` — and not by anything
// in the app. This lowers it to five minutes, runs the Playwright `soak`
// project, and puts it back.
//
// It is guarded by `requireDevTarget`, the same three-guard entry point every
// fixture script uses: the registry must allow fixtures on the named target,
// the loaded credentials must be that target's, and the DATABASE must identify
// itself as `dev`. This changes a project-wide auth setting, so it must be
// incapable of reaching a tenant — a shortened token lifetime on a client's
// system would be a real (if temporary) security-posture change made by a test.
//
// ── THE RESTORE IS THE LOAD-BEARING PART ────────────────────────────────────
//
// The original value is restored in a `finally` and on SIGINT, and the restore
// is verified by re-reading rather than trusting the PATCH. If it still fails,
// the exact command to fix it is printed. As a second line of defence,
// `jwt_exp` is declared in `supabase/apply-auth-config.mjs`, so
// `npm run auth:config:check:dev` reports a value left behind by a run that
// died in a way no handler could catch.

import { spawn } from 'node:child_process'
import { requireDevTarget, orExitAsync } from './lib/fixtureGuard.mjs'

/**
 * Five minutes — Supabase's floor for `jwt_exp`.
 *
 * Lower would be better and is not offered; the API clamps, which is why the
 * effective value is always re-read rather than assumed.
 */
const SOAK_JWT_EXP_S = 300

const ENDPOINT = ref => `https://api.supabase.com/v1/projects/${ref}/config/auth`

class RequestFailed extends Error {}

async function request(target, method, body) {
  const resp = await fetch(ENDPOINT(target.config.projectRef), {
    method,
    headers: {
      Authorization: `Bearer ${target.env.SUPABASE_ACCESS_TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await resp.text()
  if (!resp.ok) throw new RequestFailed(`HTTP ${resp.status} on ${method} config/auth: ${text}`)
  return JSON.parse(text)
}

/** Sets jwt_exp and returns what the API actually stored. */
async function setJwtExp(target, seconds) {
  await request(target, 'PATCH', { jwt_exp: seconds })
  const after = await request(target, 'GET')
  return after.jwt_exp
}

function runPlaywright(env) {
  return new Promise(resolve => {
    // `npx.cmd` by name rather than `shell: true`: node 24 warns (DEP0190) that
    // shell-spawned arguments are concatenated rather than escaped, and there is
    // no reason to take that on when the executable's name is the only thing
    // that differs by platform.
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const child = spawn(npx, ['playwright', 'test', '--project=soak', '--reporter=list'], {
      stdio: 'inherit',
      env,
    })
    child.on('close', code => resolve(code ?? 1))
  })
}

/**
 * Credentials are checked BEFORE anything is mutated.
 *
 * Discovering a missing password after lowering the token lifetime means the
 * project sits shortened while somebody goes looking for it.
 */
function assertCredentials() {
  const missing = ['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD'].filter(name => !process.env[name])
  if (missing.length === 0) return
  console.error(
    `Missing ${missing.join(' and ')}. The soak signs in through the real login ` +
      'form, as the seeded Admin demo account. See tests/e2e/README.md.',
  )
  return 1
}

async function main() {
  const credsMissing = assertCredentials()
  if (credsMissing) return credsMissing

  const target = await orExitAsync(() =>
    requireDevTarget({ require: ['SUPABASE_ACCESS_TOKEN'] }),
  )

  const before = await request(target, 'GET')
  const originalJwtExp = before.jwt_exp

  console.log(`Session soak — ${target.name} (${target.config.label}), project ${target.config.projectRef}`)
  console.log(`  jwt_exp is ${originalJwtExp}s; the soak needs it at ${SOAK_JWT_EXP_S}s.`)

  // Already short — leave it exactly as found. Restoring a value nobody
  // changed is how a "temporary" setting becomes permanent by accident.
  const needsChange = originalJwtExp > SOAK_JWT_EXP_S
  let effective = originalJwtExp

  const restore = async () => {
    if (!needsChange) return
    try {
      const back = await setJwtExp(target, originalJwtExp)
      console.log(`  jwt_exp restored to ${back}s.`)
      if (back !== originalJwtExp) throw new RequestFailed(`readback says ${back}s`)
    } catch (e) {
      console.error(
        `\n!! jwt_exp was NOT restored (${e.message}).\n` +
          `!! The ${target.name} project is still on a ${SOAK_JWT_EXP_S}s token lifetime.\n` +
          `!! Fix it with:\n` +
          `!!   curl -X PATCH ${ENDPOINT(target.config.projectRef)} \\\n` +
          `!!     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \\\n` +
          `!!     -H "Content-Type: application/json" \\\n` +
          `!!     -d '{"jwt_exp": ${originalJwtExp}}'\n` +
          `!! Or run \`npm run auth:config:${target.name}\`, which now declares it.\n`,
      )
    }
  }

  // Ctrl-C during a twelve-minute wait is the likeliest way this gets
  // interrupted, and it is exactly when the restore matters most.
  let interrupted = false
  const onSignal = () => {
    if (interrupted) return
    interrupted = true
    console.log('\nInterrupted — restoring jwt_exp before exiting.')
    restore().finally(() => {
      process.exitCode = 130
      setTimeout(() => process.exit(130), 100)
    })
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    if (needsChange) {
      effective = await setJwtExp(target, SOAK_JWT_EXP_S)
      console.log(`  jwt_exp now ${effective}s (the API clamps, so this is the readback).`)
    }

    // A refresh fires ~90s before expiry, so a cycle is (lifetime - 90s).
    console.log(
      `  expect a refresh roughly every ${effective - 90}s; three cycles is about ` +
        `${Math.ceil((3 * (effective - 90)) / 60)} minutes.\n`,
    )

    // The tokens under test are minted by the project, not by the front end —
    // but the front end has to be one pointed AT that project, so default to
    // the target's own deployed origin rather than to localhost.
    const env = {
      ...process.env,
      E2E_BASE_URL: process.env.E2E_BASE_URL ?? target.config.appOrigin,
      SOAK_TOKEN_LIFETIME_S: String(effective),
    }
    console.log(`  against ${env.E2E_BASE_URL}\n`)

    return await runPlaywright(env)
  } finally {
    if (!interrupted) await restore()
  }
}

// No process.exit() on the success path: undici keep-alive sockets are still
// open and exiting on top of one trips a libuv assertion on Windows, which
// looks like a crash on an otherwise clean run. Same rule as
// supabase/apply-auth-config.mjs and fixtureGuard's orExitAsync.
try {
  process.exitCode = await main()
} catch (err) {
  console.error(err instanceof RequestFailed ? err.message : err)
  process.exitCode = 1
}
