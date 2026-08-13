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

// ── A DISABLED MODULE'S FUNCTIONS ARE NOT DEPLOYED AT ALL ───────────────────
//
// `_shared/modules.ts` makes them answer 403, which is the backstop. This makes
// them ABSENT, which is the same guarantee the frontend gives: `lib/modules.ts`
// compiles a disabled module out of the bundle rather than hiding it, and a
// server surface that merely refuses is a weaker promise than one that was
// never uploaded.
//
// What it deliberately does NOT do is retire a function already deployed to a
// project whose module was later switched off. Deleting a live Edge Function is
// not a decision a deploy script should take on its own — so it is reported,
// with the command to run, and left alone.

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { disabledFunctionsFor } from '../../config/moduleOwnership.mjs'
import { resolveTarget, orExit, ROOT } from '../../scripts/lib/env.mjs'

const argv = process.argv.slice(2)
const target = orExit(() => resolveTarget({ argv, require: ['SUPABASE_ACCESS_TOKEN'] }))

const requested = argv.filter((a) => !a.startsWith('--'))
const disabled = new Set(disabledFunctionsFor(target.config))

/** Every function directory on disk. */
function allFunctionNames() {
  return readdirSync(resolve(ROOT, 'supabase/functions'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_shared')
    .map((e) => e.name)
    .sort()
}

// Naming a disabled function explicitly is a mistake worth stopping, not
// silently dropping: the operator asked for something specific by name.
const refused = requested.filter((n) => disabled.has(n))
if (refused.length) {
  console.error(
    `[fn:deploy] ✖ ${refused.join(', ')} belong${refused.length === 1 ? 's' : ''} to a module ` +
      `that is not enabled for ${target.name}.\n` +
      `[fn:deploy]   ${target.name} has: ${target.config.modules.join(', ')}\n` +
      `[fn:deploy]   Enable it in config/environments.mjs, or deploy a different function.`,
  )
  process.exit(1)
}

// With every module on — today's state for both targets — this stays exactly
// what it was: no name list, and the CLI deploys everything.
let names = requested
if (!requested.length && disabled.size) {
  names = allFunctionNames().filter((n) => !disabled.has(n))
  console.log(
    `[fn:deploy] skipping ${disabled.size} function(s) from disabled module(s): ` +
      `${[...disabled].join(', ')}`,
  )
  console.log(
    `[fn:deploy] NOTE: any of those already deployed to ${target.config.projectRef} stay deployed.\n` +
      `[fn:deploy]   They answer 403 (_shared/modules.ts), but if you want them gone:\n` +
      `[fn:deploy]   npx supabase functions delete <name> --project-ref ${target.config.projectRef}`,
  )
}

const args = ['supabase', 'functions', 'deploy', ...names, '--project-ref', target.config.projectRef]

console.log(
  `[fn:deploy] ${target.name} (${target.config.projectRef}) — ` +
    `${names.length ? `${names.length} function(s)` : 'all functions'}`,
)

const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: true,
  cwd: ROOT,
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: target.env.SUPABASE_ACCESS_TOKEN },
})

process.exit(result.status ?? 1)
