import { defineConfig } from 'vitest/config';
import path from 'path';

// Live-DB integration tests. Kept separate from the default offline suite so
// `npm test` never needs database creds or network. Run with:
//   npm run test:integration
export default defineConfig({
    resolve: {
        alias: { '@': path.resolve(__dirname, '.') },
    },
    test: {
        environment: 'node',
        include: ['**/*.integration.test.ts'],
        // Load .env.local into process.env before the suite runs.
        setupFiles: ['./__tests__/support/loadEnv.ts'],
        // Live DB round-trips are slower than unit tests.
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
