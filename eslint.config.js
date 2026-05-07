// Flat config (ESLint 9). Closes audit pain-point #8 in M3 batch 0.
//
// Goal: lint actually runs as a CI gate. Conservative rules — catch the
// genuinely-broken (unused vars without _ prefix, missing React hook deps,
// react-refresh boundary issues), not aspirationally tight.
//
// Globals split:
//   src/  → browser globals (Vite SPA)
//   worker/  → worker/edge runtime (no node, no window)
//   tests/  → vitest globals + node + browser (helpers run in jsdom-ish env)
//   scripts/  → node globals (build helpers)

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
    {
        ignores: [
            'dist/**',
            'coverage/**',
            'node_modules/**',
            '.wrangler/**',
            'public/**',
            // Build artifacts and tooling outputs
            '**/*.min.js',
            // Single-file HTML tools — not lintable as JS modules
            'tools/**/*.html',
        ],
    },

    // Base rules for all JS/JSX
    js.configs.recommended,

    {
        files: ['**/*.{js,jsx}'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        rules: {
            // Block real bugs but tolerate _-prefixed intentional discards.
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
                destructuredArrayIgnorePattern: '^_',
            }],
            // Console is fine in worker (logs); tolerate in scripts too.
            'no-console': 'off',
            // Empty catch blocks are sometimes intentional (best-effort cleanup).
            'no-empty': ['warn', { allowEmptyCatch: true }],
            // Prefer-const useful but not blocking.
            'prefer-const': 'warn',
        },
    },

    // SPA src/ — browser globals + react-hooks + react-refresh
    //
    // Note: we intentionally do NOT use `reactHooks.configs.recommended.rules`.
    // v7 added many new strict rules (purity, set-state-in-effect, immutability,
    // etc.) that the existing codebase wasn't written against. We pick only
    // the legacy "rules of hooks" + "exhaustive-deps" — the M2-baseline lint
    // gate. Future milestones can opt into more rules incrementally.
    {
        files: ['src/**/*.{js,jsx}'],
        languageOptions: {
            globals: { ...globals.browser },
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            'react-hooks/rules-of-hooks': 'error',
            // useEffect deps are routinely intentionally narrow in this codebase
            // (refresh controlled by route changes / props). Warn, don't error.
            'react-hooks/exhaustive-deps': 'warn',
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        },
    },

    // Worker — no browser, has fetch/Request/Response/crypto + Cloudflare-specific
    // (HTMLRewriter, ExecutionContext) via global. Lib functions also use Date,
    // Math, Array, Object, JSON which are all in serviceworker globals already.
    {
        files: ['worker/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.worker,
                ...globals.serviceworker,
                fetch: 'readonly',
                Request: 'readonly',
                Response: 'readonly',
                Headers: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                crypto: 'readonly',
                console: 'readonly',
                btoa: 'readonly',
                atob: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                // Cloudflare Workers-specific globals not in standard worker preset
                HTMLRewriter: 'readonly',
            },
        },
    },

    // Tests — vitest globals + node + browser (helpers reach into both worlds)
    {
        files: ['tests/**/*.{js,jsx}'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
                describe: 'readonly',
                it: 'readonly',
                expect: 'readonly',
                vi: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
            },
        },
        rules: {
            // Tests intentionally have unused destructured fixture fields.
            'no-unused-vars': 'off',
            // Test fixtures use string-quoted JSON-like literals where escape
            // characters help readability even when not strictly required.
            'no-useless-escape': 'off',
        },
    },

    // Scripts — node + bash interop helpers
    {
        files: ['scripts/**/*.{js,mjs,cjs}'],
        languageOptions: {
            globals: { ...globals.node },
        },
    },

    // Tools — single-file HTML/JS helpers (cover-banner-builder etc.)
    {
        files: ['tools/**/*.{js,html}'],
        languageOptions: {
            globals: { ...globals.browser },
        },
    },

    // Top-level config files (vite.config.js, playwright.config.js, etc.) — Node
    {
        files: ['*.config.js', '*.config.mjs', '*.config.cjs', 'vitest.*.{js,mjs,cjs}'],
        languageOptions: {
            globals: { ...globals.node },
        },
    },
];
