// audit Group I — public-route smoke suite (#77-#83).
//
// These tests run against a DEPLOYED Worker via Playwright. They are
// operator-triggered (`npm run test:e2e`) and NOT part of `npm test`.
// See playwright.config.js for baseURL configuration.
//
// Audit map:
//   #77 — GET / returns 200 + contains "Air Action Sports"
//   #78 — GET /events returns 200 + page mounts (relaxed from "lists at
//                                                least one event card")
//   #79 — GET /events/:slug returns 200 + injects per-event OG title
//                                          (test.skip when no E2E_TEST_EVENT_SLUG)
//   #80 — GET /booking returns 200
//   #81 — GET /waiver?token=invalid returns 200 with error UX
//   #82 — GET /v/<bad-token> returns 200 with error UX
//   #83 — GET /admin redirects to /admin/login when no cookie
//                                          (client-side, via React Router)

import { test, expect } from '@playwright/test';
import { getEventSlug } from './setup.js';

test('#77 GET / returns 200 and contains "Air Action Sports"', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Air Action Sports');
});

test('#78 GET /events returns 200 and the events page mounts', async ({ page }) => {
    // Relaxed from audit's stricter form ("lists at least one event card")
    // to avoid coupling the smoke suite to live data state. If a guaranteed-
    // published seed event exists in the deploy under test, tighten this
    // assertion to await an actual event-card selector.
    const res = await page.goto('/events');
    expect(res?.status()).toBe(200);
    expect(page.url()).toContain('/events');
    // Body renders something (SPA shell + mounted React tree).
    await expect(page.locator('body')).toBeVisible();
});

test('#79 GET /events/:slug injects per-event OG title via worker rewriter', async ({ request }) => {
    const slug = getEventSlug();
    test.skip(!slug, 'E2E_TEST_EVENT_SLUG env var not set — pass a known published slug to enable.');

    const res = await request.get(`/events/${slug}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    // Worker's rewriteEventOg() injects og:title (and og:url, og:image) for
    // matched slugs. Assert presence of the og:title meta tag — exact title
    // text varies per event so we don't pin it.
    expect(html).toMatch(/<meta\s+[^>]*property=["']og:title["']/i);
});

test('#80 GET /booking returns 200', async ({ request }) => {
    const res = await request.get('/booking');
    expect(res.status()).toBe(200);
});

test('#81 GET /waiver?token=invalid renders an error UX', async ({ page }) => {
    const res = await page.goto('/waiver?token=invalid');
    expect(res?.status()).toBe(200);
    // Wait for SPA to mount and render the error state. Regex is permissive
    // on purpose — fragile to copy changes; widen if the SPA uses different
    // wording.
    await expect(page.locator('body')).toContainText(/invalid|expired|error|not found/i, { timeout: 10_000 });
});

test('#82 GET /v/<bad-token> renders an error UX', async ({ page }) => {
    const res = await page.goto('/v/bad-token-1234567890');
    expect(res?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(/invalid|expired|error|not found/i, { timeout: 10_000 });
});

test('#83 GET /admin redirects to /admin/login when no session cookie', async ({ page }) => {
    // The redirect is client-side (React Router) — see
    // src/admin/AdminDashboard.jsx line 33: `navigate('/admin/login', { replace: true })`.
    // page.waitForURL waits for the SPA's redirect to land.
    await page.goto('/admin');
    await page.waitForURL(/\/admin\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/admin\/login/);
});
