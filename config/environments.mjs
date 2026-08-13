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
 * products, customers (HoReCa), suppliers, users, settings, audit, system
 * health — are not listed because they are not gateable; an ordering system
 * without them is not the product.
 *
 * ── THESE ARE THE THREE THE SIDEBAR ALREADY DRAWS ───────────────────────────
 *
 * This list held nine finer-grained slugs (warehouse, po_inbox, field_sales,
 * customer_portal, purchasing, invoicing, promotions, analytics, email) from
 * the day the seam was designed until 2026-08-13, while nothing read it. It is
 * now three, and they are deliberately the three group headings in
 * `components/AppShell.tsx` — "Sales & Orders", "Field Ops", "Inventory &
 * Dispatch" — because that is what a customer is actually sold, and a gate the
 * operator cannot point at on screen is a gate nobody can reason about.
 *
 * The nine were also finer than the product: `po_inbox` without `sales_orders`
 * has nowhere to put an approved order, and `analytics` without the surface it
 * reports on shows empty charts. Splitting further is easy later; un-splitting
 * after a tenant has bought one of the nine is not.
 *
 * ONE BOOLEAN PER MODULE, NEVER AN ARRAY, on the consuming side — `arr
 * .includes(x)` is a runtime call that survives tree-shaking and would ship
 * every byte of a disabled module. The array lives here, where it is
 * configuration; `lib/modules.ts` turns it into constants Vite can fold. That
 * is the difference between *hidden* and *not shipped*.
 *
 * See MULTI-TENANT-ARCHITECTURE.md §3 for the three layers.
 */
export const ALL_MODULES = ['sales_orders', 'field_ops', 'inventory_dispatch']

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
      // The preview glob follows `vercel.teamSlug` and nothing else. It read
      // `https://*-dulshan657s-projects.vercel.app/**` until 2026-08-13 — the
      // OLD account's slug. An allow-list entry naming a team this deployment
      // no longer belongs to is not merely stale: it grants password-reset
      // landing rights to every preview build on someone else's account.
      // Change it in the same commit as `teamSlug`, then re-run
      // `npm run auth:config:dev` — the list lives in Supabase, not here.
      'https://*-nexgen13.vercel.app/**',
    ],

    vercel: {
      /**
       * `nexorder-demo` on the `nexgen13` team, created 2026-08-13 — a
       * DIFFERENT Vercel account from the one holding Amadiya, matching the
       * Supabase split above.
       *
       * These four were briefly null on purpose. They used to name
       * `prj_DdZRpjyAQKwmL6MiCKmbO9I7zhiI` on `team_evk2SaoAF3naWcjrBdCo1gbL`
       * — the ORIGINAL demo project, on the account that also holds Amadiya's,
       * which survived the cutover still building `main` with demo logins
       * against what had become a client's production database. Leaving those
       * ids beside a `projectRef` pointing at the new Supabase project would
       * have made `deploy:dev` push a demo build to the client's account.
       *
       * `teamSlug` matters beyond cosmetics: `deploy.mjs` picks the deployment
       * URL out of the CLI's stdout by matching `-<teamSlug>.vercel.app`, so a
       * stale slug fails the ALIAS step AFTER a successful build — the site
       * stays on the old deployment while the deploy reports success. Fill all
       * four together or none.
       *
       * There is deliberately NO Git integration on this project. `deploy.mjs`
       * is the only sanctioned path because it aliases and then verifies both
       * `/version.json` and `/functions/v1/health`; a Git connection would add
       * a second, unverified one and re-create the old project's failure mode.
       */
      teamSlug: 'nexgen13',
      projectId: 'prj_304AOnH18ynYP1WsEO5wRTWeUif1',
      orgId: 'team_OzW1Ry9bFz67QReqkvBcQIyb',
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

    /**
     * FALSE — this project cannot accept custom auth email templates.
     *
     * Supabase refuses `mailer_subjects_*` / `mailer_templates_*` on a FREE
     * project using the built-in email provider: "Email template modification
     * is not available for free tier projects using the default email
     * provider." Discovered on the first `auth:config:dev` run, 2026-08-13.
     *
     * The reason this is a registry flag rather than a try/catch is that the
     * PATCH is ALL-OR-NOTHING. Sending the templates alongside the real
     * settings meant `site_url`, `uri_allow_list`, `password_min_length` and
     * `disable_signup` were rejected too — so a cosmetic limitation silently
     * left the project accepting 6-character passwords, allowing public signup,
     * and pointing password resets at `localhost:3000`. Declaring the
     * capability keeps `--check` honest as well: it reports drift on settings
     * that CAN be applied, instead of failing forever on four that cannot.
     *
     * Flip to true when this project gets custom SMTP or a paid plan. The
     * built-in mailer is also what stamps a `supabase.io` sender and exposes
     * the project ref in auth mail, so custom SMTP is worth doing for its own
     * sake — it just is not worth blocking the demo rebuild on.
     */
    authEmailTemplates: false,

    /**
     * Everything on, and on dev that is not negotiable: the demo has to be able
     * to show any module to a prospect, and dev is where a module gate is
     * proven to work before it decides what a paying tenant sees.
     */
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

    /** Pro plan — custom auth email templates are accepted. See dev's note. */
    authEmailTemplates: true,

    /**
     * Everything on: Amadiya bought all three. The gate ships in the all-on
     * state ON PURPOSE — it has to be proven inert against a live tenant before
     * it is ever the thing withholding a surface from one. Removing a slug here
     * is how a module is turned off, and it takes a rebuild, because the
     * frontend half is compiled out rather than hidden.
     */
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
