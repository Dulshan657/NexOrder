#!/usr/bin/env node
// Deploy + alias + verification + recording, for one named environment.
//
//   node scripts/deploy.mjs --env=dev     (npm run deploy:dev)
//   node scripts/deploy.mjs --env=prod    (npm run deploy:prod)
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

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: ['inherit', 'pipe', 'inherit'], shell: true, ...opts })
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
