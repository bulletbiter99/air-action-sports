import { vi } from 'vitest';
import { createMockD1 } from './mockD1.js';

// Factory for a Workers `env` object matching the bindings declared in
// wrangler.toml. Returns a fresh shape each call so tests don't leak state
// across runs. Pass `overrides` to replace specific bindings or env vars.
//
// Default rate limiters allow every request; tests that exercise rate-limit
// gating override the relevant binding's `limit` to return `{success:false}`.
export function createMockEnv(overrides = {}) {
    const env = {
        // D1 binding
        DB: createMockD1(),

        // R2 binding
        UPLOADS: {
            get: vi.fn(),
            put: vi.fn(),
            delete: vi.fn(),
        },

        // 9 rate-limit bindings — namespaces 1001-1009 in wrangler.toml.
        // Each gets its own vi.fn() so per-test mutation doesn't leak to other bindings.
        RL_LOGIN: { limit: vi.fn().mockResolvedValue({ success: true }) },
        RL_FORGOT: { limit: vi.fn().mockResolvedValue({ success: true }) },
        RL_VERIFY_TOKEN: { limit: vi.fn().mockResolvedValue({ success: true }) },
        RL_RESET_PWD: { limit: vi.fn().mockResolvedValue({ success: true }) },
        RL_CHECKOUT: { limit: vi.fn().mockResolvedValue({ success: true }) },
        RL_TOKEN_LOOKUP: { limit: vi.fn().mockResolvedValue({ success: true }) },
        RL_FEEDBACK: { limit: vi.fn().mockResolvedValue({ success: true }) },
        RL_FEEDBACK_UPLOAD: { limit: vi.fn().mockResolvedValue({ success: true }) },
        RL_QUOTE: { limit: vi.fn().mockResolvedValue({ success: true }) },

        // Public env vars (mirror wrangler.toml [vars])
        SITE_URL: 'https://airactionsport.com',
        FROM_EMAIL: 'Air Action Sports Test <noreply@example.com>',
        REPLY_TO_EMAIL: 'test@example.com',
        ADMIN_NOTIFY_EMAIL: 'test@example.com',

        // Secrets (mock values — NEVER use real tokens in tests).
        // SESSION_SECRET length matches the production posture (>=32 bytes).
        STRIPE_SECRET_KEY: 'sk_test_mock_key',
        STRIPE_WEBHOOK_SECRET: 'whsec_mock_secret_for_testing_only',
        RESEND_API_KEY: 're_mock_api_key',
        SESSION_SECRET: 'test_session_secret_must_be_at_least_32_bytes_long_padding',

        // Static asset binding — undefined by default. Tests that exercise the
        // SPA fallback path (`env.ASSETS.fetch(request)`) provide their own.
        ASSETS: undefined,
    };

    return { ...env, ...overrides };
}
