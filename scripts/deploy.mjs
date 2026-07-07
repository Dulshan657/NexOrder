#!/usr/bin/env node
// Production deploy + alias + verification + recording.
//
//   1. Capture the local commit sha/branch and pass GIT_COMMIT_SHA to the
//      remote build (Vercel CLI builds without .git, so vite.config.ts can't
//      resolve it there).
//   2. `vercel deploy --prod` and re-point the nexorder.vercel.app alias
//      (NEVER skip the alias — users test against nexorder.vercel.app).
//   3. Poll https://nexorder.vercel.app/version.json until it serves the
//      deployed sha (5s interval, 120s budget) → VERIFIED / TIMEOUT.
//   4. Record a `deployments` row via the service role (creds from
//      .env.local, pattern: tests/fixtures/po-samples/inject.mjs). Insert
//      failure only warns; verification timeout exits 1 (the alias has
//      already succeeded — the exit code just flags the unverified state).

import { spawnSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ALIAS = 'nexorder.vercel.app';
const VERIFY_INTERVAL_MS = 5_000;
const VERIFY_BUDGET_MS = 120_000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: ['inherit', 'pipe', 'inherit'], shell: true, ...opts });
  if (result.status !== 0) {
    console.error(`\n[deploy] "${cmd} ${args.join(' ')}" exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout.toString();
}

function gitInfo() {
  try {
    const sha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim();
    return { sha, branch };
  } catch {
    return { sha: null, branch: null };
  }
}

function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (env[m[1]] === undefined || env[m[1]] === '') env[m[1]] = v;
    }
  } catch {
    /* no .env.local — rely on process.env */
  }
  return env;
}

async function pollVersion(sha) {
  const deadline = Date.now() + VERIFY_BUDGET_MS;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`https://${ALIAS}/version.json`, { cache: 'no-store' });
      if (resp.ok) {
        const json = await resp.json();
        if (json?.sha === sha) return true;
        console.log(`[deploy] version.json still serving ${json?.sha ?? 'unknown'}; waiting...`);
      }
    } catch (e) {
      console.log(`[deploy] version.json poll failed (${e?.message ?? e}); retrying...`);
    }
    await new Promise((r) => setTimeout(r, VERIFY_INTERVAL_MS));
  }
  return false;
}

async function recordDeployment({ sha, branch, url, verified }) {
  const env = loadEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.warn('[deploy] VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — deployment not recorded.');
    return;
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
    });
    if (!resp.ok) {
      console.warn(`[deploy] deployments insert failed: HTTP ${resp.status} ${await resp.text().catch(() => '')}`);
    } else {
      console.log('[deploy] Deployment recorded in `deployments`.');
    }
  } catch (e) {
    console.warn(`[deploy] deployments insert threw: ${e?.message ?? e}`);
  }
}

const { sha, branch } = gitInfo();
console.log(`[deploy] Deploying to production... (sha ${sha?.slice(0, 7) ?? 'unknown'}, branch ${branch ?? 'unknown'})`);

const deployArgs = ['deploy', '--prod', '--yes'];
if (sha) deployArgs.push('--build-env', `GIT_COMMIT_SHA=${sha}`);
const stdout = run('vercel', deployArgs);
process.stdout.write(stdout);

const urlMatch = stdout.match(/https:\/\/[a-z0-9-]+\.vercel\.app/gi) ?? [];
const deploymentUrl = urlMatch.find((u) => u.includes('-dulshan657s-projects.vercel.app')) ?? urlMatch[0];

if (!deploymentUrl) {
  console.error('[deploy] Could not parse deployment URL from vercel output. Alias NOT updated.');
  process.exit(1);
}

console.log(`\n[deploy] Deployment URL: ${deploymentUrl}`);
console.log(`[deploy] Aliasing ${ALIAS} -> ${deploymentUrl}`);
run('vercel', ['alias', 'set', deploymentUrl, ALIAS]);

console.log(`\n[deploy] Done. https://${ALIAS} is now live on ${deploymentUrl}`);

let verified = false;
if (sha) {
  console.log(`[deploy] Verifying ${ALIAS}/version.json serves ${sha.slice(0, 7)}...`);
  verified = await pollVersion(sha);
  console.log(verified ? '[deploy] VERIFIED — production serves the deployed sha.'
    : '[deploy] TIMEOUT — version.json did not serve the deployed sha within 120s.');
} else {
  console.warn('[deploy] No git sha available — skipping verification.');
}

await recordDeployment({ sha, branch, url: deploymentUrl, verified });

if (sha && !verified) {
  console.error('[deploy] NOTE: the alias already succeeded — the site is live, just not verified. Exiting 1 to flag it.');
  process.exit(1);
}
