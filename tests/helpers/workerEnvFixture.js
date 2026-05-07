// Worker-level test fixture (M4 B1a — Group G).
//
// serveUpload, rewriteEventOg, and the scheduled() handler in worker/index.js
// are not exported individually, so tests exercise them through the default
// export's fetch / scheduled hooks. This helper provides:
//
//   - createWorkerEnv()   — mockEnv() pre-wired with an ASSETS binding
//   - buildAssetsBinding() — fakes the static-asset fetch fallback
//   - buildSpaShellHtml() — minimal index.html with the meta tags rewriteEventOg targets
//   - buildCtx()          — fake ExecutionContext with capturable waitUntil
//   - installHTMLRewriterMock() — replaces globalThis.HTMLRewriter so tests can
//                                 inspect on()/transform() calls without needing
//                                 the Cloudflare runtime
//
// HTMLRewriter is a Workers runtime API; Node tests don't have it. The mock
// captures handler registrations and lets a test invoke a handler against a
// fake element to verify what setAttribute/setInnerContent it would call.

import { vi } from 'vitest';
import { createMockEnv } from './mockEnv.js';

export function buildSpaShellHtml() {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Air Action Sports</title>
<meta name="description" content="default description">
<meta property="og:title" content="default og title">
<meta property="og:description" content="default og description">
<meta property="og:url" content="">
<meta property="og:image" content="">
<meta property="og:type" content="website">
<meta name="twitter:title" content="default twitter title">
<meta name="twitter:description" content="default twitter description">
<meta name="twitter:image" content="">
</head>
<body><div id="app"></div></body>
</html>`;
}

export function buildAssetsBinding(html = buildSpaShellHtml()) {
    return {
        fetch: vi.fn().mockResolvedValue(
            new Response(html, {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }),
        ),
    };
}

export function buildCtx() {
    const promises = [];
    return {
        waitUntil: vi.fn((p) => { promises.push(p); }),
        passThroughOnException: vi.fn(),
        // Test-only: await every promise scheduled via waitUntil so post-promise
        // state is observable before assertions run.
        __settle: async () => { await Promise.allSettled(promises); },
    };
}

export function createWorkerEnv(overrides = {}) {
    return createMockEnv({
        ASSETS: buildAssetsBinding(),
        ...overrides,
    });
}

export function installHTMLRewriterMock() {
    const calls = [];
    let lastTransformedResponse = null;

    class HTMLRewriterMock {
        constructor() {
            this._handlers = [];
        }
        on(selector, handler) {
            const entry = { selector, handler };
            calls.push(entry);
            this._handlers.push(entry);
            return this;
        }
        transform(response) {
            // Pass through — actual rewriting is Cloudflare runtime behavior.
            // Tests inspect captured `calls` to verify intent.
            lastTransformedResponse = response;
            return response;
        }
    }

    const original = globalThis.HTMLRewriter;
    globalThis.HTMLRewriter = HTMLRewriterMock;

    return {
        calls,
        getLastTransformedResponse: () => lastTransformedResponse,
        restore: () => {
            if (original === undefined) delete globalThis.HTMLRewriter;
            else globalThis.HTMLRewriter = original;
        },
        // Simulate the Cloudflare runtime invoking the handler against a real
        // element. Returns the array of capture entries — one per setAttribute
        // / setInnerContent call the handler made.
        invokeHandler: (selector) => {
            const c = calls.find((x) => x.selector === selector);
            if (!c) return null;
            const captured = [];
            const elem = {
                setAttribute: vi.fn((name, value) => {
                    captured.push({ method: 'setAttribute', name, value });
                }),
                setInnerContent: vi.fn((content, opts) => {
                    captured.push({ method: 'setInnerContent', content, opts });
                }),
            };
            c.handler.element(elem);
            return captured;
        },
    };
}
