import { defineConfig } from 'vitest/config';
import { configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: { '@': path.resolve(__dirname, '.') },
    },
    test: {
        environment: 'node',
        include: ['**/*.test.ts'],
        // Live-DB integration tests run via vitest.integration.config.ts only;
        // keep the default suite offline (no DB creds / network needed).
        exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
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
    },
});
