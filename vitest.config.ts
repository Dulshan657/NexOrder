import { defineConfig } from 'vitest/config';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const alias = { '@': path.resolve(__dirname, '.') };

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
                    include: ['**/*.test.tsx'],
                    exclude: [...configDefaults.exclude],
                },
            },
        ],
    },
});
