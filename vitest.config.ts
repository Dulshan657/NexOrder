import { defineConfig } from 'vitest/config';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// @ts-expect-error — .mjs registry, no types, and `allowJs` is off.
import { TEST_PROJECT_REF } from './config/environments.mjs';

const alias = { '@': path.resolve(__dirname, '.') };

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
                test: {
                    name: 'node',
                    environment: 'node',
                    env: OFFLINE_SUPABASE_ENV,
                    include: ['**/*.test.ts'],
                    // Live-DB integration tests run via vitest.integration.config.ts only;
                    // keep the default suite offline (no DB creds / network needed).
                    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
                },
            },
            {
                resolve: { alias },
                plugins: [react()],
                test: {
                    name: 'ui',
                    environment: 'jsdom',
                    env: OFFLINE_SUPABASE_ENV,
                    include: ['**/*.test.tsx'],
                    exclude: [...configDefaults.exclude],
                },
            },
        ],
    },
});
