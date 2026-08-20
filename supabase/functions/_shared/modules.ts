// Module gating, server side. Layer B of MULTI-TENANT-ARCHITECTURE.md §3.
//
// A module is a whole surface a tenant may not have bought. The frontend half
// is compiled out of that tenant's bundle (`lib/modules.ts`), which is what
// makes a disabled module *absent* rather than merely hidden. This is the other
// half: the Edge Functions that back those surfaces refuse to run.
//
// ── THIS FAILS OPEN, AND THAT IS THE DESIGN ─────────────────────────────────
//
// `ENABLED_MODULES` unset means EVERY module is enabled. Not "none".
//
// A module gate is a COMMERCIAL control — it answers "did they pay for this".
// The SECURITY controls are roles and RLS, and they are enforced independently
// on every one of these functions; nothing here is the only thing standing
// between a user and data they should not see.
//
// So the two failure directions are not symmetric. Failing closed on a missing
// secret takes a paying tenant's warehouse offline the first time a secret is
// dropped during a project migration — and `_shared/cors.ts` has already shown
// (2026-07-29) that a missing secret degrades a fleet GRADUALLY, since it is
// read once per isolate, so the outage would arrive hours late and look like a
// client bug. Failing open in the same situation means someone briefly reaches
// a surface they did not buy, with their own role and their own RLS still
// applied, and the fix is one `npm run secrets:<target>`.
//
// `supabase/ops/secrets.mjs` derives this value from the registry and re-applies
// it on every run, alongside ALLOWED_ORIGINS and APP_URL, for exactly the reason
// those three are derived: drift between the registry and the project IS the
// bug. It is therefore never hand-typed and never read from an env file.
//
// ── READ ONCE PER ISOLATE, DELIBERATELY ─────────────────────────────────────
//
// Same shape as `cors.ts`. A secret change needs a redeploy to take effect on
// warm isolates. That is a known property of the platform rather than something
// this module can fix, and it is why turning a module off is a deploy-shaped
// operation, not a dashboard toggle.

import { EdgeFunctionError } from './errors.ts'

/**
 * The vocabulary. Must agree with `ALL_MODULES` in `config/environments.mjs` —
 * that file is the source of truth and this is a hand-kept copy, because
 * `_shared` cannot import from outside `supabase/functions`. A slug that does
 * not appear here is rejected at parse time below rather than silently ignored,
 * which is what turns a typo in the secret into a loud failure instead of a
 * module that quietly never gates.
 */
export const MODULE_SLUGS = [
  'sales_orders',
  'shop',
  'po_inbox',
  'promotions',
  'invoicing',
  'field_ops',
  'inventory_dispatch',
] as const

export type ModuleSlug = (typeof MODULE_SLUGS)[number]

function parseEnabled(): ReadonlySet<ModuleSlug> | null {
  const raw = Deno.env.get('ENABLED_MODULES')
  if (raw === undefined || raw.trim() === '') return null // unset ⇒ everything on

  const slugs = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const unknown = slugs.filter((s) => !MODULE_SLUGS.includes(s as ModuleSlug))
  if (unknown.length) {
    // Loud, but not fatal: an unrecognised slug is a config error, and treating
    // the whole secret as unreadable would fail the request rather than the
    // deploy. The known slugs in the same list still apply.
    console.error(
      `[modules] ENABLED_MODULES lists unknown module(s): ${unknown.join(', ')}. ` +
        `Known: ${MODULE_SLUGS.join(', ')}. Check config/environments.mjs ALL_MODULES ` +
        `and re-run secrets:<target>.`,
    )
  }

  return new Set(slugs.filter((s): s is ModuleSlug => MODULE_SLUGS.includes(s as ModuleSlug)))
}

// Module scope, so it is read once per isolate. See the header.
const ENABLED = parseEnabled()

/** Is this module enabled for the project this function is deployed to? */
export function isModuleEnabled(slug: ModuleSlug): boolean {
  return ENABLED === null || ENABLED.has(slug)
}

/**
 * Refuse the request when the module that owns this function is not enabled.
 *
 * Call it alongside `requireAuth`, not instead of it: this says "the tenant did
 * not buy this", `requireAuth` says "you are not allowed to do this", and only
 * the second is a security boundary.
 *
 * 403 rather than 404: pretending the function does not exist would be a lie
 * that makes a misconfigured secret indistinguishable from a failed deploy, and
 * the caller here is always the tenant's own staff, not an attacker probing for
 * surfaces.
 */
export function requireModule(slug: ModuleSlug): void {
  if (isModuleEnabled(slug)) return
  throw new EdgeFunctionError(
    'FORBIDDEN',
    `The ${slug.replace(/_/g, ' ')} module is not enabled for this deployment.`,
    { module: slug },
  )
}
