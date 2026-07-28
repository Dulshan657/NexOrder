// scripts/lib/devClient.mjs
//
// One line of setup for every seed / demo / reset script:
//
//   import { createDevClient } from '<...>/scripts/lib/devClient.mjs'
//   const { supa, env } = await createDevClient()
//
// Replaces the fourteen hand-copied `loadEnv()` blocks that each read
// `.env.local` and each defaulted, silently, to whatever project that file
// happened to point at. Every one of them held a service-role key, so every
// one of them could rewrite a database without a single prompt.
//
// Applies all three guards from PRODUCTION-LAUNCH-PLAN.md §A2.3 before the
// client is constructed — including asking the database itself whether it is
// dev. There is no --force, and adding one would defeat the point.

import { createClient } from '@supabase/supabase-js'

import { requireDevTarget, orExitAsync } from './fixtureGuard.mjs'

/**
 * Resolve a dev-only target, verify it three ways, and return a service-role
 * client for it.
 *
 * @param {object} [options]
 * @param {string[]} [options.argv]
 * @param {boolean} [options.quiet]
 * @returns {Promise<{ supa: import('@supabase/supabase-js').SupabaseClient, env: Record<string,string>, target: any }>}
 */
export async function createDevClient(options = {}) {
  const target = await orExitAsync(() =>
    requireDevTarget({
      argv: options.argv,
      require: ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ACCESS_TOKEN'],
    }),
  )

  if (!options.quiet) {
    console.log(
      `[fixtures] ${target.name} — ${target.config.supabaseUrl} ` +
        `(marker: ${target.marker.name}/${target.marker.tenant_key})`,
    )
  }

  const supa = createClient(target.config.supabaseUrl, target.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return { supa, env: target.env, target }
}
