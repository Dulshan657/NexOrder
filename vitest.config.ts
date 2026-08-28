import { defineConfig } from 'vitest/config';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

import { TEST_PROJECT_REF, ALL_MODULES } from './config/environments.mjs';

const alias = { '@': path.resolve(__dirname, '.') };

/**
 * Module flags for the suite: EVERY module on.
 *
 * `lib/modules.ts` reads `__MODULE_*__` constants that `vite.config.ts`
 * substitutes at build time. Vitest runs test files through the SSR transform,
 * where `define` is NOT applied — so a `define` here silently does nothing and
 * the suite dies at import with "__MODULE_SALES_ORDERS__ is not defined". The
 * setup file assigns them onto globalThis instead, before any test module is
 * imported. `define` is kept alongside it for any client-transformed module.
 *
 * See __tests__/support/moduleGlobals.ts for why all-on is the right value and
 * how the disabled behaviour is covered instead.
 */
const MODULE_DEFINES = Object.fromEntries(
  ALL_MODULES.map((slug: string) => [`__MODULE_${slug.toUpperCase()}__`, 'true']),
);

// Paired with the globalThis assignment in the setup file, for the same reason
// and with the same value. See __tests__/support/moduleGlobals.ts.
const BUILD_DEFINES = { ...MODULE_DEFINES, __DEMO_HOST__: 'true' };

const MODULE_SETUP = [path.resolve(__dirname, '__tests__/support/moduleGlobals.ts')];

/**
 * Credentials for `lib/supabase.ts`, which throws at module load without them
 * and is transitively imported by seven test files that never touch the network.
 *
 * These used to come from `.env.local`, which Vite loads for every mode — so
 * the offline unit suite was quietly depending on a file holding a REAL
 * service-role key for a real project. That went unnoticed until the Amadiya
 * cutover deleted the file (the project it named had become a client's
 * production database, and `npm run dev` pointing a developer's browser at that
 * is not a thing to leave lying around). Seven files then failed with
 * "Missing VITE_SUPABASE_URL".
 *
 * Pinned to `TEST_PROJECT_REF`, the registry's own placeholder, so the suite
 * cannot reach a live project even by accident and the host is greppable.
 */
const OFFLINE_SUPABASE_ENV = {
  VITE_SUPABASE_URL: `https://${TEST_PROJECT_REF}.supabase.co`,
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_offline_unit_tests',
};

export default defineConfig({
    resolve: { alias },
    define: BUILD_DEFINES,
    test: {
        coverage: {
            provider: 'v8',
            include: [
                'pricing.ts',
                'services/promotionService.ts',
                'supabase/functions/_shared/poInbox/aliasResolver.ts',
                'supabase/functions/_shared/poInbox/senderTrust.ts',
            ],
            reporter: ['text', 'html'],
        },
        // Two projects rather than one jsdom environment for everything: the existing
        // suite is pure logic and should keep running under node (faster, and it never
        // needed a DOM). Only `.test.tsx` — the overlay component tests — gets jsdom.
        projects: [
            {
                resolve: { alias },
                define: BUILD_DEFINES,
                test: {
                    name: 'node',
                    environment: 'node',
                    env: OFFLINE_SUPABASE_ENV,
                    setupFiles: MODULE_SETUP,
                    include: ['**/*.test.ts'],
                    // Live-DB integration tests run via vitest.integration.config.ts only;
                    // keep the default suite offline (no DB creds / network needed).
                    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
                },
            },
            {
                resolve: { alias },
                define: BUILD_DEFINES,
                plugins: [react()],
                test: {
                    name: 'ui',
                    environment: 'jsdom',
                    env: OFFLINE_SUPABASE_ENV,
                    setupFiles: MODULE_SETUP,
                    include: ['**/*.test.tsx'],
                    exclude: [...configDefaults.exclude],
                },
            },
        ],
    },
});
