#!/usr/bin/env node
// Deploy + alias + verification + recording, for one named environment.
//
//   node scripts/deploy.mjs --env=dev       (npm run deploy:dev)
//   node scripts/deploy.mjs --env=amadiya   (npm run deploy:amadiya)
//
//   1. Capture the local commit sha/branch and pass GIT_COMMIT_SHA to the
//      remote build (Vercel CLI builds without .git, so vite.config.ts can't
//      resolve it there).
//   2. `vercel deploy` at the target's Vercel target, then re-point that
//      target's alias (NEVER skip the alias — a bare deploy leaves users
//      testing the old build and reporting fixes as "not live").
//   3. Poll https://<alias>/version.json until it serves the deployed sha
//      (5s interval, 120s budget) → VERIFIED / TIMEOUT.
//   4. Record a `deployments` row via the service role.
//
// Historical bug worth not reintroducing: recordDeployment() used to call its
// own loadEnv() reading `.env.local`, so a production deploy wrote its audit
// row into the DEV database — the one place you would later go looking to find
// out what production is running. It now uses the resolved target like
// everything else.

import { spawnSync, execSync } from 'node:child_process'
import os from 'node:os'

import { resolveTarget, orExit, ROOT } from './lib/env.mjs'

const VERIFY_INTERVAL_MS = 5_000
const VERIFY_BUDGET_MS = 120_000

const target = orExit(() => resolveTarget())
const { config } = target
const ALIAS = config.vercel.alias

/**
 * Environment handed to every `vercel` invocation.
 *
 * Pinning the project is the one hard blocker MULTI-TENANT-ARCHITECTURE.md §4
 * names on the Vercel side. A bare `vercel deploy` resolves whichever project
 * `.vercel/project.json` happens to name — a single file, holding a single id,
 * checked into nothing. With one Vercel project per tenant that means
 * `deploy:amadiya` would cheerfully build the client's branch into whatever
 * project was last linked, and the first sign of it would be the alias landing
 * on the wrong deployment.
 *
 * Both ids come from the registry so the target named on the command line is
 * the only thing that decides where this goes. Until a target's ids are filled
 * in we fall through to the CLI's own resolution, which is today's behaviour —
 * the guard below is what stops that being silent.
 *
 * ── AND THE ACCOUNT, AS OF THE DEMO REBUILD (2026-08-13) ────────────────────
 *
 * The ids alone are not enough once the fleet spans two Vercel ACCOUNTS. The
 * CLI authenticates from a single global login in `~/.local/share/com.vercel.
 * cli`, so whichever account you last ran `vercel login` against is the one
 * every deploy uses — and a project id from the other account does not resolve
 * there. The failure is not a wrong deploy but a confusing one: the CLI reports
 * the project does not exist, on a command line that names it explicitly.
 *
 * `VERCEL_TOKEN` is account-scoped and overrides the global login, so putting
 * it in the target's env file makes `--env=` decide the account, the org and
 * the project together — the same property `SUPABASE_ACCESS_TOKEN` already has
 * on the Supabase side, and for the same reason.
 *
 * ── AND FOR A TENANT IT IS NOW A REFUSAL, NOT A WARNING (2026-08-13) ────────
 *
 * The paragraph that used to sit here said falling through to the global login
 * was "deliberately NOT an error", because `.env.amadiya.local` had no
 * `VERCEL_TOKEN` and the global login happened to be Amadiya's account. That
 * reasoning only held while the coincidence held. It is exactly one
 * `vercel login` away from being false, and the failure it produces is a
 * client's production alias pointed at a build from the wrong account — the
 * single most expensive outcome this script can have.
 *
 * So: a `kind: 'tenant'` target must have its ids AND its token, or we stop.
 * A demo target still warns and falls through, because the worst case there is
 * a demo deployed to the wrong demo.
 */
let vercelEnvCache = null

function vercelEnv() {
  // Memoised because run() calls this for BOTH `vercel deploy` and
  // `vercel alias`, and a warning printed twice reads as two problems.
  if (vercelEnvCache) return vercelEnvCache
  vercelEnvCache = buildVercelEnv()
  return vercelEnvCache
}

function buildVercelEnv() {
  const { projectId, orgId } = config.vercel
  const token = target.env.VERCEL_TOKEN
  const isTenant = config.kind === 'tenant'

  if (!projectId || !orgId) {
    const missing = !projectId ? 'projectId' : 'orgId'
    if (isTenant) {
      console.error(
        `[deploy] ✖ ${target.name} is a TENANT and has no vercel.${missing} in the registry.\n` +
          `[deploy]   Without it the CLI resolves whichever project .vercel/project.json names,\n` +
          `[deploy]   which is not decided by --env and is not decided by you.\n` +
          `[deploy]   Fill in config/environments.mjs → TARGETS.${target.name}.vercel.${missing}.`,
      )
      process.exit(1)
    }
    console.warn(
      `[deploy] ⚠ ${target.name} has no vercel.${missing} in the registry.\n` +
        `[deploy]   Falling back to .vercel/project.json, which names ONE project regardless of --env.\n` +
        `[deploy]   Fill it in before there is a second Vercel project to confuse this with.`,
    )
    return token ? { ...process.env, VERCEL_TOKEN: token } : process.env
  }

  if (!token) {
    if (isTenant) {
      console.error(
        `[deploy] ✖ ${target.name} is a TENANT and has no VERCEL_TOKEN in ${config.envFile}.\n` +
          `[deploy]   The CLI would fall back to its global login — whichever account you last\n` +
          `[deploy]   ran \`vercel login\` against. That is not a property of this command line,\n` +
          `[deploy]   and getting it wrong points a client's production alias at another\n` +
          `[deploy]   account's build.\n` +
          `[deploy]\n` +
          `[deploy]   Fix: create a token on the Vercel account that owns\n` +
          `[deploy]   ${config.vercel.teamSlug} (vercel.com → Settings → Tokens), then add\n` +
          `[deploy]   VERCEL_TOKEN=... to ${config.envFile}.`,
      )
      process.exit(1)
    }
    console.warn(
      `[deploy] ⚠ ${target.name} has no VERCEL_TOKEN in ${config.envFile}.\n` +
        `[deploy]   Using the CLI's global login, which belongs to whichever account\n` +
        `[deploy]   you last ran \`vercel login\` against. With one Vercel account in the\n` +
        `[deploy]   fleet that is fine; with two, the project ids below will not resolve.`,
    )
    return { ...process.env, VERCEL_PROJECT_ID: projectId, VERCEL_ORG_ID: orgId }
  }

  return {
    ...process.env,
    VERCEL_PROJECT_ID: projectId,
    VERCEL_ORG_ID: orgId,
    VERCEL_TOKEN: token,
  }
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: ['inherit', 'pipe', 'inherit'],
    shell: true,
    env: vercelEnv(),
    ...opts,
  })
  if (result.status !== 0) {
    console.error(`\n[deploy] "${cmd} ${args.join(' ')}" exited with code ${result.status}`)
    process.exit(result.status ?? 1)
  }
  return result.stdout.toString()
}

function gitInfo() {
  try {
    const sha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim()
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim()
    return { sha, branch }
  } catch {
    return { sha: null, branch: null }
  }
}

/**
 * A TENANT DEPLOYS FROM A RELEASE TAG. NOT FROM WHATEVER IS CHECKED OUT.
 *
 * Module flags stop a tenant seeing a surface they did not buy. They do nothing
 * about a surface that exists, is theirs, and is half-finished — and with one
 * `main` and a manual tenant deploy, "everything merged since last time" is
 * exactly what a tenant deploy shipped. Those are two different problems and
 * this is the second one.
 *
 * The release train it creates has no branches in it: work merges to `main`,
 * dev deploys from `main`, you verify there, you tag, and the tenant checkout
 * moves to the tag. A tag is a claim that a specific commit was looked at.
 *
 * Three conditions, and each rules out a different way of shipping something
 * nobody verified:
 *
 *   1. a clean tree      — an uncommitted edit is in the build and in no tag
 *   2. HEAD is at a tag  — the commit was deliberately marked, not merely current
 *   3. tag is on main    — it went through whatever `main` requires; a tag on an
 *                          unmerged branch is a private commit with a label
 *
 * `dev` is deliberately exempt (`kind: 'demo'`): deploying whatever is checked
 * out is the entire point of a demo environment, and it is where a release
 * candidate is verified before it is ever tagged.
 */
function requireReleaseTag() {
  if (config.kind !== 'tenant') return

  const git = (cmd) => execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  const fail = (problem, fix) => {
    console.error(`\n[deploy] ✖ ${target.name} is a TENANT: ${problem}\n[deploy]   ${fix}\n`)
    process.exit(1)
  }

  let dirty
  try {
    dirty = git('git status --porcelain')
  } catch {
    fail('this is not a git checkout, so nothing can be verified.', 'Deploy a tenant from a checkout of this repository.')
    return
  }
  if (dirty) {
    fail(
      'the working tree has uncommitted changes.',
      'Whatever is uncommitted would be built and is in no tag. Commit or stash it first.',
    )
  }

  let tags = ''
  try {
    tags = git('git tag --points-at HEAD')
  } catch {
    /* no tags at all — handled below */
  }
  const release = tags.split('\n').map((t) => t.trim()).filter((t) => /^rel-/.test(t))
  if (!release.length) {
    fail(
      'HEAD is not at a release tag.',
      'Verify the build on dev first, then tag the commit you verified:\n' +
        '[deploy]     git tag -a rel-YYYY-MM-DD -m "what is in this release"\n' +
        '[deploy]     git push origin rel-YYYY-MM-DD\n' +
        '[deploy]   then check that tag out in this workspace and deploy again.',
    )
  }

  // `main` may legitimately be absent locally (this workspace is a detached
  // worktree), so prefer the remote-tracking ref and fall back rather than
  // refusing a deploy over a missing local branch.
  let mainRef = null
  for (const ref of ['origin/main', 'main']) {
    try {
      git(`git rev-parse --verify --quiet ${ref}`)
      mainRef = ref
      break
    } catch {
      /* try the next */
    }
  }
  if (!mainRef) {
    console.warn(
      `[deploy] ⚠ neither origin/main nor main is present here, so "${release[0]}" could not be\n` +
        `[deploy]   confirmed as merged. Proceeding on the tag alone. Run \`git fetch origin\`\n` +
        `[deploy]   in this workspace to restore the check.`,
    )
  } else {
    try {
      git(`git merge-base --is-ancestor HEAD ${mainRef}`)
    } catch {
      fail(
        `"${release[0]}" is not an ancestor of ${mainRef}.`,
        'A tag on an unmerged branch is a private commit with a label on it.\n' +
          '[deploy]   Merge to main, push, and tag the merged commit.',
      )
    }
  }

  console.log(`[deploy] release ${release.join(', ')} — clean tree, on ${mainRef ?? 'an unverified base'}`)
}

async function pollVersion(sha) {
  const deadline = Date.now() + VERIFY_BUDGET_MS
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`https://${ALIAS}/version.json`, { cache: 'no-store' })
      if (resp.ok) {
        const json = await resp.json()
        if (json?.sha === sha) return true
        console.log(`[deploy] version.json still serving ${json?.sha ?? 'unknown'}; waiting...`)
      }
    } catch (e) {
      console.log(`[deploy] version.json poll failed (${e?.message ?? e}); retrying...`)
    }
    await new Promise((r) => setTimeout(r, VERIFY_INTERVAL_MS))
  }
  return false
}

// The health endpoint is the only check that exercises the deployed frontend
// AND the Edge Functions of the same environment. A green version.json with a
// dead backend is exactly the state a one-Vercel-project setup can produce,
// because no preview ever runs production config.
async function checkHealth() {
  const url = `${config.supabaseUrl}/functions/v1/health`
  try {
    const resp = await fetch(url, { cache: 'no-store' })
    console.log(`[deploy] GET ${url} -> ${resp.status}`)
    return resp.status === 200
  } catch (e) {
    console.warn(`[deploy] health check threw: ${e?.message ?? e}`)
    return false
  }
}

async function recordDeployment({ sha, branch, url, verified }) {
  const supabaseUrl = config.supabaseUrl
  const serviceKey = target.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    console.warn(
      `[deploy] SUPABASE_SERVICE_ROLE_KEY missing from ${config.envFile} — deployment not recorded.`,
    )
    return
  }
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/deployments`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        commit_sha: sha ?? 'unknown',
        branch,
        deployer: os.userInfo().username,
        url,
        verified,
        verified_at: verified ? new Date().toISOString() : null,
      }),
    })
    if (!resp.ok) {
      console.warn(`[deploy] deployments insert failed: HTTP ${resp.status} ${await resp.text().catch(() => '')}`)
    } else {
      console.log(`[deploy] Deployment recorded in \`deployments\` on ${target.name}.`)
    }
  } catch (e) {
    console.warn(`[deploy] deployments insert threw: ${e?.message ?? e}`)
  }
}

const { sha, branch } = gitInfo()
console.log(
  `[deploy] Target ${target.name} — ${config.label}\n` +
    `[deploy] Alias ${ALIAS} · Vercel target ${config.vercel.target}\n` +
    `[deploy] sha ${sha?.slice(0, 7) ?? 'unknown'}, branch ${branch ?? 'unknown'}`,
)

// Both tenant gates fire here, before the first spawn rather than lazily inside
// it — a refusal is only worth having while nothing has happened yet.
// Release tag first: "you are deploying the wrong commit" is a more fundamental
// objection than "this target has no token", and hearing it first is the more
// useful order when both are true.
requireReleaseTag()
vercelEnv()

const deployArgs = ['deploy', '--yes']
if (config.vercel.target === 'production') deployArgs.push('--prod')
if (sha) deployArgs.push('--build-env', `GIT_COMMIT_SHA=${sha}`)
const stdout = run('vercel', deployArgs)
process.stdout.write(stdout)

const urlMatch = stdout.match(/https:\/\/[a-z0-9-]+\.vercel\.app/gi) ?? []
const deploymentUrl = urlMatch.find((u) => u.includes(`-${config.vercel.teamSlug}.vercel.app`)) ?? urlMatch[0]

if (!deploymentUrl) {
  console.error('[deploy] Could not parse deployment URL from vercel output. Alias NOT updated.')
  process.exit(1)
}

console.log(`\n[deploy] Deployment URL: ${deploymentUrl}`)
console.log(`[deploy] Aliasing ${ALIAS} -> ${deploymentUrl}`)
run('vercel', ['alias', 'set', deploymentUrl, ALIAS])

console.log(`\n[deploy] Done. https://${ALIAS} is now live on ${deploymentUrl}`)

let verified = false
if (sha) {
  console.log(`[deploy] Verifying ${ALIAS}/version.json serves ${sha.slice(0, 7)}...`)
  verified = await pollVersion(sha)
  console.log(verified ? '[deploy] VERIFIED — the alias serves the deployed sha.'
    : '[deploy] TIMEOUT — version.json did not serve the deployed sha within 120s.')
} else {
  console.warn('[deploy] No git sha available — skipping verification.')
}

const healthy = await checkHealth()
if (!healthy) {
  console.error(`[deploy] health did not return 200 on ${target.name}.`)
}

await recordDeployment({ sha, branch, url: deploymentUrl, verified })

if ((sha && !verified) || !healthy) {
  console.error('[deploy] NOTE: the alias already succeeded — the site is live, just not fully verified. Exiting 1 to flag it.')
  process.exit(1)
}
