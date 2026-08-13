// config/environments.mjs
//
// THE deployment-target registry. This is the only file in the repo where a
// Supabase project ref is allowed to appear. If you find yourself typing a ref
// anywhere else — a script, a test, a config, a comment — import it from here.
//
// Everything below is PUBLIC. Refs, URLs and origins all ship in the browser
// bundle already. Credentials live in `.env.<target>.local`, which are
// gitignored (`.env.*.local`) and are read by scripts/lib/env.mjs.
//
// Why the split exists at all: until 2026-07 there was one environment, and
// five copy-pasted `loadEnv()` implementations each defaulting to the Singapore
// ref. A seed script run with the wrong `.env.local` on disk would have written
// to whatever that file pointed at, silently. Now every script must name its
// target and every credential set is asserted against the entry below.
//
// ── WHY THESE ARE "TARGETS" AND NOT "ENVIRONMENTS" ──────────────────────────
//
// The word `prod` used to mean "Amadiya", because Amadiya was the only client.
// From the second tenant onward that word is a lie: every tenant is production,
// and "which production?" has no answer. So a target is named for WHAT IT IS —
// `dev` is the demo, `amadiya` is a tenant — and `kind` carries the distinction
// that `prod` used to smuggle.
//
// The filename stays `environments.mjs` deliberately. It is referenced from
// CLAUDE.md, from three migration headers (00086, 00098) and from
// _shared/cors.ts, and those are comments in already-applied, checksummed
// migrations. Renaming the file would buy nothing and break the paper trail.
//
// See MULTI-TENANT-ARCHITECTURE.md for the isolation decision this shape
// encodes, and PRODUCTION-LAUNCH-PLAN.md §A1 for how it came about.

/**
 * Every optional module, in the order they should be offered to a human.
 *
 * A module is a whole surface that a tenant may not have bought: nav entries,
 * routes, and Edge Functions together. The CORE surfaces — auth, dashboard,
 * products, customers, orders, users, settings, audit — are not listed because
 * they are not gateable; an ordering system without them is not the product.
 *
 * NOTHING READS THIS YET, and that is intentional. Amadiya has every module
 * enabled, so a gate would be dead code with no way to tell whether it worked.
 * The field exists so the seam is real and so a second tenant is a config
 * change rather than a refactor. The mechanism that will consume it — one
 * build-time boolean per module, NOT an array, because `arr.includes(x)` is a
 * runtime call that survives tree-shaking and would ship every byte of a
 * disabled module — is specified in MULTI-TENANT-ARCHITECTURE.md.
 */
export const ALL_MODULES = [
  'warehouse',
  'po_inbox',
  'field_sales',
  'customer_portal',
  'purchasing',
  'invoicing',
  'promotions',
  'analytics',
  'email',
]

/**
 * Placeholder ref used by unit tests. Never resolves to a real project — it
 * exists so tests can exercise ref-shaped strings without embedding a live one.
 */
export const TEST_PROJECT_REF = 'testref'

/**
 * `lsgkznyiabqitqfpveey` — Amadiya's production project since 2026-08-12.
 *
 * It was the demo until then. It is not a new Sydney project because it was
 * already IN ap-southeast-2 (this file said `ap-southeast-1` for months and was
 * simply wrong — the Management API disagrees), its organisation was already on
 * Pro, and Amadiya's 134-location warehouse was already drawn in it. The demo
 * data was exported to disk and deleted; see `supabase/ops/purge-demo.mjs`.
 */
const AMADIYA_REF = 'lsgkznyiabqitqfpveey'

/**
 * `uqvekvavkjjurpqtovbq` — the rebuilt demo, provisioned 2026-08-13.
 *
 * On a SEPARATE Supabase account and organisation from Amadiya's, which is the
 * point: the old arrangement put the demo and the client in one org, one
 * dashboard and one blast radius, and the cutover resolved that by deleting the
 * demo. Separate accounts means a mis-clicked dashboard action, a leaked
 * personal access token or a billing lapse on one side cannot reach the other.
 *
 * Consequently `SUPABASE_ACCESS_TOKEN` differs per target. That already works —
 * every Management API script reads it from the target's env file — but the
 * Vercel CLI does not, which is why `deploy.mjs` now threads `VERCEL_TOKEN`.
 */
const DEMO_REF = 'uqvekvavkjjurpqtovbq'

/**
 * Target names that were renamed, mapped to what they are now.
 *
 * `--env=prod` keeps working for one release and prints a warning, so a
 * half-updated runbook, a shell alias or a stale CI job fails LOUDLY on the
 * next line instead of silently doing nothing. Delete this map once nothing
 * references the old spelling.
 */
export const DEPRECATED_TARGET_ALIASES = {
  prod: 'amadiya',
}

export const TARGETS = {
  dev: {
    name: 'dev',
    label: 'Development / sales demo (NexGen account)',

    /**
     * 'demo' — NexGen's own. Fixtures allowed, demo logins shown, seeded data
     * expected. 'tenant' — a paying client's. None of the above, ever.
     */
    kind: 'demo',

    /**
     * PROVISIONED 2026-08-13 on a separate account — see DEMO_REF above.
     *
     * This was `null` between the 2026-08-12 cutover and that date, and while it
     * was, every `--env=dev` command refused — including every seed, demo and
     * reset script, because `fixtureTargets()` derives from `allowFixtures` and
     * this is the only entry carrying it. That was correct while it lasted:
     * there was nowhere it was safe to run a fixture, and the alternative to
     * refusing was running one against a client. Filling this in is what turns
     * the fixture scripts back on, and it is the ONLY thing that does.
     *
     * It also restores the fleet's only rehearsal environment. Every migration
     * between 2026-08-12 and today landed on a paying client with no dry run.
     */
    projectRef: DEMO_REF,
    supabaseUrl: `https://${DEMO_REF}.supabase.co`,

    /**
     * Deliberately the same region as Amadiya. A rehearsal in a different region
     * is a less faithful rehearsal, and this entry claimed `ap-southeast-1` for
     * months while pointing at a project that was actually in `ap-southeast-2` —
     * so this value is ASSERTED against the Management API, not trusted.
     */
    region: 'ap-southeast-2',

    /** Where the app is served. Also the auth Site URL. */
    appOrigin: 'https://nexorder.vercel.app',

    /**
     * Exact origins the Edge Functions will echo back as
     * Access-Control-Allow-Origin. Consumed as the `ALLOWED_ORIGINS` Edge
     * Function secret (comma-joined). `_shared/cors.ts` fails CLOSED, so an
     * origin missing from this list gets no ACAO header at all.
     */
    corsOrigins: [
      'https://nexorder.vercel.app',
      'http://localhost:3000',
      // Vite's fallback port when a second dev server is already on :3000.
      // Listed so a tab that landed there is not a silent CORS failure — an
      // origin that works in practice but is missing from this file is what
      // makes "Failed to send a request to the Edge Function" unreadable.
      'http://localhost:3001',
    ],

    /**
     * Supabase auth `uri_allow_list`. Matched as GLOBS: `*` does not cross a
     * `/`, and ForgotPasswordDialog sends `${origin}/` with a trailing slash —
     * so every entry needs a `/**` suffix or the redirect is silently replaced
     * with site_url, which reads as "the reset link sent me to the wrong place".
     */
    authRedirectAllowList: [
      'https://nexorder.vercel.app/**',
      'http://localhost:*/**',
      // The preview glob is DELIBERATELY absent until the new Vercel project
      // exists. It used to read `https://*-dulshan657s-projects.vercel.app/**`,
      // which is the OLD account's team slug — an allow-list entry naming a team
      // this deployment no longer belongs to is not merely stale, it grants
      // password-reset landing rights to every preview build on someone else's
      // account. Re-add it with the new slug in the same commit that fills in
      // `vercel.teamSlug`, then re-run `npm run auth:config:dev`.
    ],

    vercel: {
      /**
       * NULLED 2026-08-13, and this is not the same thing as "not filled in yet".
       *
       * These three used to name `prj_DdZRpjyAQKwmL6MiCKmbO9I7zhiI` on
       * `team_evk2SaoAF3naWcjrBdCo1gbL` — the ORIGINAL demo Vercel project, on
       * the account that also holds Amadiya's. That project survived the cutover
       * still building `main` with `VITE_SHOW_DEMO_LOGINS` on and its frontend
       * env pointed at what is now a client's production database.
       *
       * Leaving its ids here while `projectRef` above points at the NEW Supabase
       * project would make `npm run deploy:dev` push a demo build to the old
       * account — the one thing this whole exercise exists to stop. So they are
       * null until the new Vercel project exists, `deploy.mjs` warns loudly on
       * that path, and the warning is the intended behaviour rather than a gap.
       *
       * `teamSlug` matters beyond cosmetics: `deploy.mjs` picks the deployment
       * URL out of the CLI's stdout by matching `-<teamSlug>.vercel.app`, so a
       * stale slug fails the ALIAS step after a successful build. Fill all four
       * together or none.
       */
      teamSlug: null,
      projectId: null,
      orgId: null,
      target: 'production',
      alias: 'nexorder.vercel.app',
    },

    /**
     * What `migrate.mjs --stamp` writes into `environment_marker.name`.
     *
     * NOT the same thing as `name`, and it must not be derived from it:
     * migration 00086 constrains the column to CHECK (name IN ('dev','prod')),
     * and 00086 is applied and checksummed, so the database's vocabulary is
     * frozen at two values while target names are now open-ended. Stamping
     * `'amadiya'` there would fail the CHECK on the first production run.
     */
    markerName: 'dev',

    /** Stamped into `environment_marker.tenant_key`; see migration 00087. */
    tenantKey: 'ayam',

    /** Seed / demo / reset scripts may run here. */
    allowFixtures: true,

    /** Everything on. See ALL_MODULES — read by nothing yet, by design. */
    modules: [...ALL_MODULES],

    envFile: '.env.dev.local',
  },

  amadiya: {
    name: 'amadiya',
    label: 'Amadiya Agro Products (Sydney)',
    kind: 'tenant',

    /**
     * PROVISIONED 2026-08-12 — see AMADIYA_REF above for why this is the
     * project that used to be the demo rather than a new one.
     */
    projectRef: AMADIYA_REF,
    supabaseUrl: `https://${AMADIYA_REF}.supabase.co`,
    region: 'ap-southeast-2',

    appOrigin: 'https://nexorder.com.au',

    corsOrigins: [
      'https://nexorder.com.au',
      'https://www.nexorder.com.au',
      // No localhost. A developer machine has no business holding a CORS grant
      // against the client's database.
    ],

    /**
     * Production only. The `https://*-dulshan657s-projects.vercel.app/**`
     * preview glob must NEVER appear here — it would make any preview build a
     * valid password-reset landing page for a client account.
     */
    authRedirectAllowList: [
      'https://nexorder.com.au/**',
      'https://www.nexorder.com.au/**',
    ],

    vercel: {
      teamSlug: 'dulshan657s-projects',
      /**
       * `nexorder-amadiya`, created 2026-08-12. Both ids are passed into the
       * `vercel` child env by `deploy.mjs`, so `--env=amadiya` alone decides
       * which project is built — `.vercel/project.json` still names the old
       * demo project and must never be what resolves a tenant deploy.
       */
      projectId: 'prj_6EWD3FTyT4o6R4UvDCks2Phccfnd',
      orgId: 'team_evk2SaoAF3naWcjrBdCo1gbL',
      target: 'production',
      alias: 'nexorder.com.au',
    },

    /** See dev's note. The database's vocabulary is 'dev' | 'prod', frozen. */
    markerName: 'prod',

    tenantKey: 'amadiya',

    /** Never. There is no `--force`. */
    allowFixtures: false,

    modules: [...ALL_MODULES],

    envFile: '.env.amadiya.local',
  },
}

/**
 * Valid `--env=` values, in the order they should be offered to a human.
 * Derived, so adding a tenant is one edit rather than two that can disagree.
 */
export const ENV_NAMES = Object.keys(TARGETS)

/** Targets where seed / demo / reset scripts are permitted. Guard #1's list. */
export function fixtureTargets() {
  return Object.entries(TARGETS)
    .filter(([, config]) => config.allowFixtures)
    .map(([name]) => name)
}

/**
 * Every paying client's target.
 *
 * Test harnesses use this to fail closed. They used to name `ENVIRONMENTS.prod`
 * directly, which protected exactly one client and would have gone on quietly
 * protecting only that one after a second was added — the failure being that
 * nothing anywhere would have said so.
 *
 * @returns {Array<typeof TARGETS[keyof typeof TARGETS]>}
 */
export function tenantTargets() {
  return Object.values(TARGETS).filter((config) => config.kind === 'tenant')
}

const warnedAliases = new Set()

/**
 * Map a possibly-deprecated target name onto its canonical one, warning once.
 *
 * @param {string} name
 * @returns {string}
 */
export function canonicalTargetName(name) {
  const canonical = DEPRECATED_TARGET_ALIASES[name]
  if (!canonical) return name

  if (!warnedAliases.has(name)) {
    warnedAliases.add(name)
    console.warn(
      `[config] "--env=${name}" is deprecated and now means "--env=${canonical}". ` +
        `Update the caller — this alias is removed next release.`,
    )
  }
  return canonical
}

/**
 * @param {string} name
 * @returns {typeof TARGETS[keyof typeof TARGETS]}
 */
export function getEnvironment(name) {
  const config = TARGETS[canonicalTargetName(name)]
  if (!config) {
    throw new Error(
      `Unknown target "${name}". Valid values: ${ENV_NAMES.join(', ')}.`,
    )
  }
  return config
}

/** True once the project behind this entry actually exists. */
export function isProvisioned(config) {
  return Boolean(config.projectRef && config.supabaseUrl)
}
