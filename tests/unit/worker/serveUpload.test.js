// audit Group G #65-#67 — worker/index.js serveUpload
//
// Public R2 streamer at /uploads/<key>. Defense-in-depth against smuggling
// text/html into the storefront origin: an allowlist regex on the key shape
// + a canonical Content-Type derived from the (regex-validated) extension.
// Per docs/audit/06-do-not-touch.md (Critical), do not widen the regex
// without re-deriving the MIME mapping.
//
// G65: Allowlist regex accepts <prefix>/<random>.<image-ext> keys
// G66: Allowlist regex rejects path traversal / wrong-extension / malformed
// G67: Content-Type strictly from the ext map; immutable cache; security headers
//
// NOTE on M4-prompt-vs-code drift (resolved per do-not-touch protocol):
//   The M4 prompt mentioned `pdf` and `txt` MIME mappings, but the actual
//   SERVEABLE_KEY regex only allows jpg/jpeg/png/webp/gif. Audit (06-do-not-
//   touch.md) does not claim pdf/txt support. Tests document the actual
//   restrictive allowlist (the audit-aligned behavior).

import { describe, it, expect, beforeEach } from 'vitest';
import workerEntry from '../../../worker/index.js';
import { createWorkerEnv, buildCtx } from '../../helpers/workerEnvFixture.js';

describe('worker/index.js serveUpload (Group G #65-#67)', () => {
    let env;
    let ctx;

    beforeEach(() => {
        env = createWorkerEnv();
        ctx = buildCtx();
    });

    describe('G65 — allowlist accepts valid <prefix>/<random>.<ext>', () => {
        const validKeys = [
            'events/abc123.png',
            'events/AbCdEfG-1.jpg',
            'feedback/abc-def_ghi.webp',
            'covers/qWeR_-12.jpeg',
            'misc/x.gif',
            'a/b.png',                       // minimal valid
            'event-cover-images/Op-1.webp',  // hyphens in prefix
            'feedback/ABCdef_123-z.gif',
        ];
        for (const key of validKeys) {
            it(`accepts ${key}`, async () => {
                env.UPLOADS.get.mockResolvedValue({
                    body: 'mock-body',
                    httpEtag: '"abc123"',
                });
                const req = new Request(`https://airactionsport.com/uploads/${key}`);
                const res = await workerEntry.fetch(req, env, ctx);
                expect(res.status).toBe(200);
                expect(env.UPLOADS.get).toHaveBeenCalledWith(key);
            });
        }
    });

    describe('G66 — allowlist rejects wrong extensions and malformed keys', () => {
        // Each entry is [requestPath, reasonForRejection].
        // The Worker decodes the URL path before matching, so URL-encoded
        // traversal sequences must also fail. Literal `../` segments are
        // normalized away by `new URL()` before they ever reach serveUpload —
        // those are covered by the dedicated URL-normalization test below.
        const malicious = [
            ['events/script.js',     'wrong extension (.js)'],
            ['events/page.html',     'wrong extension (.html)'],
            ['events/doc.pdf',       'pdf NOT in allowlist (audit-aligned, not M4-prompt-aligned)'],
            ['events/notes.txt',     'txt NOT in allowlist (audit-aligned, not M4-prompt-aligned)'],
            ['..%2F..%2Fpasswd.png', 'url-encoded traversal — decoded to ../../passwd.png and regex-rejected'],
            ['..png',                'no random part / no prefix slash'],
            ['events/.png',          'empty random part (regex requires [a-zA-Z0-9_-]+ before the dot)'],
            ['events//double.png',   'double slash (regex requires exactly one segment separator)'],
            ['events/abc.PNG',       'uppercase ext rejected (regex extension group is lowercase-only)'],
            ['events/abc',           'no extension'],
        ];

        for (const [path, reason] of malicious) {
            it(`rejects ${path} (${reason})`, async () => {
                const req = new Request(`https://airactionsport.com/uploads/${path}`);
                const res = await workerEntry.fetch(req, env, ctx);
                expect(res.status).toBe(404);
                // Defense-in-depth assertion: R2 must NOT be queried for invalid keys.
                expect(env.UPLOADS.get).not.toHaveBeenCalled();
            });
        }

        // Belt-and-suspenders: literal `../` segments are normalized away by
        // the URL parser before they reach serveUpload at all. The request
        // ends up routed to the ASSETS fallback, not /uploads/. R2 is still
        // never queried — the security property holds, just at a different layer.
        it('literal ../ in URL is normalized away by URL parser (never reaches serveUpload)', async () => {
            const req = new Request('https://airactionsport.com/uploads/events/../../../passwd.png');
            const res = await workerEntry.fetch(req, env, ctx);
            // After normalization, pathname is /passwd.png — falls through to
            // ASSETS.fetch which our mock returns 200 for. The critical
            // assertion is that R2 was NOT queried.
            expect(env.UPLOADS.get).not.toHaveBeenCalled();
            // And ASSETS WAS hit (the request was routed away from /uploads/).
            expect(env.ASSETS.fetch).toHaveBeenCalled();
            // Status comes from the ASSETS mock (200 SPA shell).
            expect(res.status).toBe(200);
        });
    });

    describe('G67 — Content-Type, caching, and infrastructure invariants', () => {
        const mimeCases = [
            ['png',  'image/png'],
            ['jpg',  'image/jpeg'],
            ['jpeg', 'image/jpeg'],
            ['webp', 'image/webp'],
            ['gif',  'image/gif'],
        ];
        for (const [ext, mime] of mimeCases) {
            it(`${ext} → Content-Type ${mime}`, async () => {
                env.UPLOADS.get.mockResolvedValue({ body: 'x', httpEtag: '' });
                const req = new Request(`https://airactionsport.com/uploads/events/abc.${ext}`);
                const res = await workerEntry.fetch(req, env, ctx);
                expect(res.headers.get('Content-Type')).toBe(mime);
            });
        }

        it('Cache-Control is public + 1y + immutable', async () => {
            env.UPLOADS.get.mockResolvedValue({ body: 'x', httpEtag: '"etag-123"' });
            const req = new Request('https://airactionsport.com/uploads/events/abc.png');
            const res = await workerEntry.fetch(req, env, ctx);
            expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
        });

        it('ETag passed through from R2 object', async () => {
            env.UPLOADS.get.mockResolvedValue({ body: 'x', httpEtag: '"r2-etag-xyz"' });
            const req = new Request('https://airactionsport.com/uploads/events/abc.png');
            const res = await workerEntry.fetch(req, env, ctx);
            expect(res.headers.get('ETag')).toBe('"r2-etag-xyz"');
        });

        it('returns 500 if env.UPLOADS not bound', async () => {
            env.UPLOADS = undefined;
            const req = new Request('https://airactionsport.com/uploads/events/abc.png');
            const res = await workerEntry.fetch(req, env, ctx);
            expect(res.status).toBe(500);
        });

        it('returns 404 when R2 returns null for a valid key', async () => {
            env.UPLOADS.get.mockResolvedValue(null);
            const req = new Request('https://airactionsport.com/uploads/events/abc.png');
            const res = await workerEntry.fetch(req, env, ctx);
            expect(res.status).toBe(404);
        });

        it('security headers applied on success path', async () => {
            env.UPLOADS.get.mockResolvedValue({ body: 'x', httpEtag: '' });
            const req = new Request('https://airactionsport.com/uploads/events/abc.png');
            const res = await workerEntry.fetch(req, env, ctx);
            expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
            expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
            expect(res.headers.get('X-Frame-Options')).toBe('DENY');
            expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        });

        it('security headers applied on 404 path (regex rejection)', async () => {
            const req = new Request('https://airactionsport.com/uploads/evil.html');
            const res = await workerEntry.fetch(req, env, ctx);
            expect(res.status).toBe(404);
            expect(res.headers.get('X-Frame-Options')).toBe('DENY');
        });
    });
});
