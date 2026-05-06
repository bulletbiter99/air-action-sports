import { defineConfig } from 'vitest/config';

// Vitest config for Worker-side tests. Runs in Node 20+ where Web Crypto
// (`crypto.subtle`, `crypto.getRandomValues`) is available globally.
//
// Independent of vite.config.js — that's for the React frontend (browser env).
// React component tests, when added in a later milestone, can introduce a
// jsdom env via a separate workspace or per-file pragma.
export default defineConfig({
    test: {
        environment: 'node',
        setupFiles: ['./tests/setup.js'],
        include: ['tests/unit/**/*.test.js'],
        // E2E tests run under Playwright (see playwright.config.js). Vitest
        // skips them so the two runners don't fight over the same files.
        exclude: [
            'tests/e2e/**',
            '**/node_modules/**',
            '**/dist/**',
            '**/.wrangler/**',
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'json'],
            include: ['worker/**/*.js'],
            exclude: [
                '**/node_modules/**',
                'tests/**',
            ],
        },
    },
});
