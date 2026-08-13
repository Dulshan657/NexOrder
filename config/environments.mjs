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
    label: 'Development / sales demo (NOT PROVISIONED)',

    /**
     * 'demo' — NexGen's own. Fixtures allowed, demo logins shown, seeded data
     * expected. 'tenant' — a paying client's. None of the above, ever.
     */
    kind: 'demo',

    /**
     * DELIBERATELY NULL as of 2026-08-12. The project this used to name became
     * Amadiya's production database; the demo is being rebuilt on a separate
     * Supabase + Vercel account, and its ref goes here when it exists.
     *
     * Until then every `--env=dev` command refuses, and — because
     * `fixtureTargets()` is derived from `allowFixtures` and this is the only
     * entry carrying it — every seed, demo and reset script in the repo refuses
     * with it. That is the correct state, not a regression: there is currently
     * nowhere it is safe to run a fixture, and the alternative to refusing is
     * running one against a client.
     */
    projectRef: null,
    supabaseUrl: null,
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
      'https://*-dulshan657s-projects.vercel.app/**',
    ],

    vercel: {
      teamSlug: 'dulshan657s-projects',
      /**
       * One Vercel PROJECT per target — see MULTI-TENANT-ARCHITECTURE.md.
       *
       * READ, as of the Amadiya cutover: `deploy.mjs` passes both into the
       * `vercel` child env, so `--env=` alone decides which project is built.
       * A bare `vercel deploy` resolves whichever project
       * `.vercel/project.json` names — one file, one id — which is fine with
       * one project and silently wrong with two.
       */
      projectId: 'prj_DdZRpjyAQKwmL6MiCKmbO9I7zhiI',
      orgId: 'team_evk2SaoAF3naWcjrBdCo1gbL',
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

    /**
     * Custom SMTP for Supabase Auth (password reset + invite).
     *
     * Without this the project uses Supabase's BUILT-IN mailer, which sends from
     * `noreply@mail.app.supabase.io`, appends its own
     * `supabase.com/opt-out/<projectRef>` footer — so the ref reaches a client's
     * inbox no matter what the email template says — and is capped at 2 messages
     * an hour, which cannot onboard a team.
     *
     * The sender is on the PRODUCT domain, not the tenant's. It matches
     * `appOrigin` and therefore the link inside the email, so SPF/DKIM/DMARC all
     * align on one domain. `amadiya.com.au` would not work even if we wanted it:
     * a sending domain must be DNS-verified at the provider, and NexGen does not
     * control the client's DNS.
     *
     * `passEnv` NAMES the credential; it is never stored here. Everything in this
     * file is public.
     */
    authSmtp: {
      senderEmail: 'noreply@nexorder.com.au',
      senderName: 'Nex Order',
      host: 'smtp.resend.com',
      port: 465,
      user: 'resend',
      passEnv: 'RESEND_API_KEY',
      /** Per hour. Supabase's built-in default is 2 — see above. */
      ratePerHour: 30,
    },

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
