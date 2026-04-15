#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const ALIAS = 'nexorder.vercel.app';

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: ['inherit', 'pipe', 'inherit'], shell: true, ...opts });
  if (result.status !== 0) {
    console.error(`\n[deploy] "${cmd} ${args.join(' ')}" exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout.toString();
}

console.log('[deploy] Deploying to production...');
const stdout = run('vercel', ['deploy', '--prod', '--yes']);
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
