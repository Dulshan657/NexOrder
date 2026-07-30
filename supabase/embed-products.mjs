#!/usr/bin/env node
// Refresh the product-embedding table by invoking the embed-products Edge
// Function (mig 00089).
//
// Thin on purpose: all the logic — staleness by content hash, batching, the
// OpenAI call, the upsert, orphan cleanup — lives in the function, so a cron
// invocation and this script cannot drift. This only resolves credentials for the
// named environment and posts.
//
// Usage:
//   node supabase/embed-products.mjs --env=dev [--dry-run] [--force] [--limit=N]
//
// `--env=<dev|prod>` is required, equals-form only, like every other script here.
// Safe to re-run: unchanged products hash the same and are skipped, so a second
// run embeds nothing and costs nothing.

import { resolveTarget, orExit } from '../scripts/lib/env.mjs'

const args = process.argv.slice(2)

function flag(name) {
  return args.includes(`--${name}`)
}

function numeric(name) {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`))
  if (!hit) return undefined
  const value = Number(hit.slice(name.length + 3))
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`[embed-products] --${name} must be a positive integer`)
    process.exit(1)
  }
  return value
}

const { name, config, env } = orExit(() =>
  resolveTarget({ argv: args, require: ['SUPABASE_SERVICE_ROLE_KEY'] }),
)

const body = {}
if (flag('dry-run')) body.dry_run = true
if (flag('force')) body.force = true
const limit = numeric('limit')
if (limit !== undefined) body.limit = limit

const url = `${config.supabaseUrl}/functions/v1/embed-products`
console.log(`[embed-products] target ${name} (${config.projectRef})`)
if (body.dry_run) console.log('[embed-products] dry run — no OpenAI calls, no writes')

const response = await fetch(url, {
  method: 'POST',
  headers: {
    // The function's in-body gate accepts this (or EMBED_PRODUCTS_CRON_TOKEN);
    // it runs with verify_jwt = false because sb_secret_* is not JWT-format.
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})

const raw = await response.text()
let payload = null
try {
  payload = raw ? JSON.parse(raw) : null
} catch {
  payload = null
}

if (!response.ok || !payload?.ok) {
  console.error(`[embed-products] FAILED (${response.status})`)
  console.error(raw.slice(0, 2000))
  process.exit(1)
}

console.log(JSON.stringify(payload, null, 2))

// The headline: how much of the catalog is now retrievable.
if (!payload.dry_run) {
  console.log(
    `[embed-products] ${payload.embedded} embedded, ` +
      `${payload.already_current} already current, ` +
      `${payload.orphans_removed} orphan(s) removed, ` +
      `$${payload.cost_usd} spent.`,
  )
  if (payload.skipped_by_limit > 0) {
    // Never let a bounded run read as a complete one.
    console.log(
      `[embed-products] ${payload.skipped_by_limit} stale product(s) NOT embedded because of --limit. ` +
        `Re-run to finish.`,
    )
  }
}
