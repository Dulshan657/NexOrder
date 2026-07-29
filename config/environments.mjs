// config/environments.mjs
//
// THE environment registry. This is the only file in the repo where a Supabase
// project ref is allowed to appear. If you find yourself typing a ref anywhere
// else — a script, a test, a config, a comment — import it from here instead.
//
// Everything below is PUBLIC. Refs, URLs and origins all ship in the browser
// bundle already. Credentials live in `.env.dev.local` / `.env.prod.local`,
// which are gitignored (`.env.*.local`) and are read by scripts/lib/env.mjs.
//
// Why the split exists at all: until 2026-07 there was one environment, and
// five copy-pasted `loadEnv()` implementations each defaulting to the Singapore
// ref. A seed script run with the wrong `.env.local` on disk would have written
// to whatever that file pointed at, silently. Now every script must name its
// target and every credential set is asserted against the entry below.
//
// See PRODUCTION-LAUNCH-PLAN.md §A1.

/** Valid `--env=` values, in the order they should be offered to a human. */
export const ENV_NAMES = ['dev', 'prod']

/**
 * Placeholder ref used by unit tests. Never resolves to a real project — it
 * exists so tests can exercise ref-shaped strings without embedding a live one.
 */
export const TEST_PROJECT_REF = 'testref'

const DEV_REF = 'lsgkznyiabqitqfpveey'

export const ENVIRONMENTS = {
  dev: {
    name: 'dev',
    label: 'Development / sales demo (Singapore)',

    projectRef: DEV_REF,
    supabaseUrl: `https://${DEV_REF}.supabase.co`,
    region: 'ap-southeast-1',

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
       * TODAY: `main` deploys to production and carries this alias.
       * A8 flips this entry to `target: 'preview'` on the `develop` branch,
       * at which point `nexorder.vercel.app` becomes the dev/demo URL and
       * `nexorder.com.au` becomes production. Do not flip it early — deploy.mjs
       * reads this and would start shipping previews instead of the demo.
       */
      target: 'production',
      alias: 'nexorder.vercel.app',
    },

    /** Stamped into `environment_marker.tenant_key`; see migration 00087. */
    tenantKey: 'ayam',

    /** Seed / demo / reset scripts may run here. */
    allowFixtures: true,

    envFile: '.env.dev.local',
  },

  prod: {
    name: 'prod',
    label: 'Production — Amadiya Agro Products (Sydney)',

    /**
     * NOT YET PROVISIONED. Fill these three in the moment the Sydney project
     * exists (PRODUCTION-LAUNCH-PLAN.md §A0.3) — resolveTarget() throws a
     * pointed error until then, which is deliberate: it is better for every
     * prod-targeted command to refuse than for one of them to guess.
     *
     * Also fill the prod Supabase host into vercel.json's CSP `img-src`,
     * `connect-src` and `frame-src` at the same time. That is tracked as a
     * Gate B assertion.
     */
    projectRef: null,
    supabaseUrl: null,
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
      target: 'production',
      alias: 'nexorder.com.au',
    },

    tenantKey: 'amadiya',

    /** Never. There is no `--force`. */
    allowFixtures: false,

    envFile: '.env.prod.local',
  },
}

/**
 * @param {string} name
 * @returns {typeof ENVIRONMENTS[keyof typeof ENVIRONMENTS]}
 */
export function getEnvironment(name) {
  const config = ENVIRONMENTS[name]
  if (!config) {
    throw new Error(
      `Unknown environment "${name}". Valid values: ${ENV_NAMES.join(', ')}.`,
    )
  }
  return config
}

/** True once the project behind this entry actually exists. */
export function isProvisioned(config) {
  return Boolean(config.projectRef && config.supabaseUrl)
}
