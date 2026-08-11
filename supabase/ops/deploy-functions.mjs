#!/usr/bin/env node
// Deploy Edge Functions to one named project.
//
//   node supabase/ops/deploy-functions.mjs --env=dev              # all functions
//   node supabase/ops/deploy-functions.mjs --env=dev send-email   # just one
//
// Wraps `npx supabase functions deploy` so the project ref comes from the
// registry instead of being typed. Typing a ref is how a function lands in the
// wrong project, and a wrongly-deployed function is invisible until something
// downstream misbehaves.
//
// NEVER pass --no-verify-jwt here. `supabase/config.toml` governs the JWT gate
// per function, and the nine `verify_jwt = false` entries there each
// re-implement auth in-body. Overriding on the command line silently diverges
// the deployed state from the file that documents it.
//
// Nine, not eight: `embed-products` was added after this comment was written,
// and the count is a Gate A assertion — count it, don't remember it.

import { spawnSync } from 'node:child_process'

import { resolveTarget, orExit, ROOT } from '../../scripts/lib/env.mjs'

const argv = process.argv.slice(2)
const target = orExit(() => resolveTarget({ argv, require: ['SUPABASE_ACCESS_TOKEN'] }))

const names = argv.filter((a) => !a.startsWith('--'))

const args = ['supabase', 'functions', 'deploy', ...names, '--project-ref', target.config.projectRef]

console.log(
  `[fn:deploy] ${target.name} (${target.config.projectRef}) — ` +
    `${names.length ? names.join(', ') : 'all functions'}`,
)

const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: true,
  cwd: ROOT,
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: target.env.SUPABASE_ACCESS_TOKEN },
})

process.exit(result.status ?? 1)
