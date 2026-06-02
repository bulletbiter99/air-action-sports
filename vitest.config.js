import { defineConfig } from 'vitest/config';

// Vitest config. Two test lanes share this single config:
//   * Worker-side tests (`*.test.js`) run in the default Node 20+ env, where
//     Web Crypto (`crypto.subtle`, `crypto.getRandomValues`) is global.
//   * React component tests (`*.test.jsx`, added in M8 Batch A) opt into a
//     jsdom env per-file via a `// @vitest-environment jsdom` pragma. All
//     jsdom-only concerns (jest-dom matchers, RTL `afterEach(cleanup)`, a
//     ResizeObserver stub for TanStack Virtual) live in the
//     tests/helpers/renderComponent.jsx helper that every component test
//     imports — so this config and tests/setup.js stay env-agnostic and the
//     existing Node worker tests are untouched.
//
// `esbuild.jsx: 'automatic'` makes esbuild transform JSX in the .jsx test files
// via the automatic runtime (no `React` import, no react-refresh `$RefreshReg$`
// errors). It only affects files that contain JSX, so the Node .js tests are
// unaffected — which is why we use esbuild here rather than wiring the
// already-installed @vitejs/plugin-react into this config.
//
// Independent of vite.config.js — that's the React frontend (browser) build.
export default defineConfig({
    esbuild: { jsx: 'automatic' },
    test: {
        environment: 'node',
        setupFiles: ['./tests/setup.js'],
        include: ['tests/unit/**/*.test.{js,jsx}'],
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
