# 01 — Stack Inventory

Snapshot of the technology stack as it exists on `audit/phase-1` (off `main`, commit at audit start: `a0478a7`). Every claim cites a file path; line numbers given where the claim depends on a specific block.

## Top-line summary

React 19 client SPA (Vite 8) served from a Cloudflare Worker. Hono router for `/api/*`, raw SQL on Cloudflare D1, R2 for blob storage, custom HMAC-signed cookie auth, Resend for email, Stripe Checkout for payments. No ORM, no TypeScript, no test suite, no CI workflows in-repo.

## Framework + runtime

| Concern | Value | Evidence |
|---|---|---|
| Frontend framework | React 19.2 | [package.json:17-18](package.json) |
| Build tool | Vite 8.0 | [package.json:31](package.json), [vite.config.js:1-20](vite.config.js) |
| Router | React Router 7.14 (SPA, `BrowserRouter`) | [package.json:20](package.json), [src/main.jsx:3](src/main.jsx), [src/App.jsx:1](src/App.jsx) |
| Frontend rendering | **Client-only SPA** — no SSR, no RSC. Lazy `import()` per route. | [src/App.jsx:7-56](src/App.jsx) |
| Worker framework | Hono 4.12 | [package.json:15](package.json), [worker/index.js:1](worker/index.js) |
| Worker entry | `worker/index.js` | [wrangler.toml:2](wrangler.toml) |
| Compatibility date | `2026-04-03` | [wrangler.toml:3](wrangler.toml) |
| Language | **JavaScript (no TypeScript).** `@types/react` is in devDeps for editor IntelliSense, but no `tsconfig.json` exists in the repo. | [package.json:24-25](package.json); no `tsconfig*.json` at any non-`node_modules` path |
| Node version | **Not pinned.** No `.nvmrc`, no `package.json#engines`, no Dockerfile, no `.tool-versions`. Cloudflare Workers Builds picks a default. | confirmed via Glob of `{.nvmrc,.node-version,Dockerfile,.tool-versions,...}` → no matches |
| Package manager | **npm** (lock file: `package-lock.json`). | [package-lock.json](package-lock.json) at repo root; no `pnpm-lock.yaml` / `yarn.lock` / `bun.lock*` |

## Hosting

| Concern | Value | Evidence |
|---|---|---|
| Compute | Cloudflare Workers, single Worker named `air-action-sports` | [wrangler.toml:1-2](wrangler.toml) |
| Static assets | `dist/` uploaded as Worker assets, bound as `env.ASSETS`, with `not_found_handling = "single-page-application"` and `run_worker_first = true` | [wrangler.toml:8-12](wrangler.toml) |
| Database | Cloudflare D1 (SQLite). DB binding `env.DB`, name `air-action-sports-db`, ID `d72ea71b-f12f-4684-93a2-52fbe9037527` | [wrangler.toml:14-18](wrangler.toml) |
| Blob storage | Cloudflare R2. Binding `env.UPLOADS`, bucket `air-action-sports-uploads` | [wrangler.toml:20-22](wrangler.toml); served publicly via `worker/index.js:429-440` (allowlist regex on key + ext-derived MIME) |
| Cron | Single trigger `*/15 * * * *` | [wrangler.toml:24-27](wrangler.toml) |
| Rate limiting | 8 Workers Rate Limiting bindings (beta `[[unsafe.bindings]]`): `RL_LOGIN`, `RL_FORGOT`, `RL_VERIFY_TOKEN`, `RL_RESET_PWD`, `RL_CHECKOUT`, `RL_TOKEN_LOOKUP`, `RL_FEEDBACK`, `RL_FEEDBACK_UPLOAD`. Namespaces 1001–1008. | [wrangler.toml:43-96](wrangler.toml) |
| Public env vars | `SITE_URL=https://airactionsport.com`, `FROM_EMAIL`, `REPLY_TO_EMAIL`, `ADMIN_NOTIFY_EMAIL` | [wrangler.toml:29-33](wrangler.toml) |
| Custom domain | `https://airactionsport.com` (canonical); `air-action-sports.bulletbiter99.workers.dev` still resolves | [wrangler.toml:30](wrangler.toml), [vite.config.js:7](vite.config.js) |
| Build hook | `[build] command = "npm run build"` declared in `wrangler.toml`, but per HANDOFF §13 the wrangler 4.x asset existence check short-circuits before this fires; the actual build is configured in the Cloudflare dashboard as `npm run build && npx wrangler deploy` | [wrangler.toml:5-6](wrangler.toml); see [HANDOFF.md:531](HANDOFF.md) |

## Database / data layer

- **Engine**: Cloudflare D1 (SQLite-backed, edge-hosted).
- **Query layer**: **Raw SQL** via `env.DB.prepare(...).bind(...).all()|.first()|.run()`. No ORM. Confirmed by absence of Prisma/Drizzle/Kysely in `package.json` and direct SQL strings in every route file (sampled at [worker/index.js:129-140](worker/index.js), [worker/routes/admin/bookings.js], etc.).
- **Migrations**: 20 files in [migrations/](migrations) numbered `0001_*` through `0019_*`. **Anomaly**: there are **two** files numbered `0010` — `0010_session_version.sql` and `0010_vendors.sql`. Wrangler migration ordering is alphabetic by filename, so `session_version` runs before `vendors`. Flag for Area 3 (data model) and Area 8 (pain points).

## Authentication

| Concern | Value | Evidence |
|---|---|---|
| Strategy | Custom HMAC-signed cookie sessions (no JWT library, no third-party auth) | [worker/lib/session.js](worker/lib/session.js), [worker/lib/auth.js](worker/lib/auth.js) |
| Password hash | PBKDF2 SHA-256 @ 100,000 iterations (Workers runtime maximum) | [worker/lib/password.js](worker/lib/password.js); HANDOFF §13 documents the 100k cap |
| Admin login routes | `worker/routes/admin/auth.js` (login / logout / setup / forgot / reset / verify-invite / accept-invite) | [worker/index.js:96](worker/index.js), [worker/routes/admin/auth.js](worker/routes/admin/auth.js) |
| Vendor portal auth | Separate `aas_vendor` cookie session, `worker/lib/vendorSession.js` + `worker/routes/vendorAuth.js` | [worker/index.js:94](worker/index.js), [worker/lib/vendorSession.js](worker/lib/vendorSession.js) |
| Vendor magic-link | HMAC token signed with `SESSION_SECRET`, version-bumpable for instant revoke | [worker/lib/vendorToken.js](worker/lib/vendorToken.js) |
| Frontend auth context | `src/admin/AdminContext.jsx` (cookie-based; no token-in-localStorage) | [src/admin/AdminContext.jsx](src/admin/AdminContext.jsx) |

## UI / styling

| Concern | Value | Evidence |
|---|---|---|
| CSS strategy | Hand-written CSS modules under `src/styles/*.css` and per-page CSS imports. **No Tailwind, no shadcn/ui, no styled-components, no Emotion.** | [src/styles/global.css](src/styles/global.css), [src/styles/admin.css](src/styles/admin.css); confirmed by absence in `package.json` |
| Component library | None — components are bespoke under `src/components/`. | confirmed by absence in `package.json` |
| Icons | Inline SVG / emoji per page; no icon library declared | confirmed by absence in `package.json` |
| Forms | Custom `useFormValidation` hook. **No Zod, Formik, react-hook-form, Yup, or Valibot.** | [src/hooks/useFormValidation.js](src/hooks/useFormValidation.js) |
| State management | React Context only (`AdminContext`). No Redux, Zustand, Jotai, TanStack Query, SWR. | [src/admin/AdminContext.jsx](src/admin/AdminContext.jsx) |

## Notable runtime libraries

| Library | Version | Purpose |
|---|---|---|
| `@zxing/browser` | ^0.1.5 | Camera-based QR scanning at `/admin/scan` |
| `qrcode` | ^1.5.4 | QR code generation (printable tickets, rental sheets, walk-in payment QRs) |
| `react-helmet-async` | ^3.0.0 | Per-route `<title>` + `<meta>` injection on the SPA side |
| `docx` | ^9.6.1 | Used by `generate_waiver.py`/`scripts/build_waiver_v2.cjs` flow that builds the legal waiver source-of-truth document. **Not** imported by any `src/` or `worker/` file (verify in Area 4 / Area 8). |

## Testing

**There is no automated test suite in-repo.**

- No `vitest`, `jest`, `mocha`, `ava`, `playwright`, `cypress`, `puppeteer`, `@testing-library/*`, `c8`, `nyc`, or `msw` in [package.json](package.json).
- No `test`, `test:unit`, `test:e2e`, `coverage`, or comparable scripts in [package.json:6-11](package.json).
- No `__tests__/`, `tests/`, `test/`, `e2e/`, `*.test.js`, or `*.spec.js` files anywhere (verified via Glob in this audit; will re-confirm in Area 9).

## Linting / formatting

- ESLint 9.39 + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` are in [package.json:23-29](package.json).
- **No flat config file exists.** `eslint.config.js`, `eslint.config.mjs`, `eslint.config.cjs` all return zero matches; no `.eslintrc*` either.
- Effect: `npm run lint` (which runs `eslint .`) would error out with "Could not find config file" or fall back to ESLint's zero-config defaults. **Flag for Area 8.**
- No Prettier, no Biome.

## CI/CD

- **No `.github/workflows/` directory exists** (confirmed via `Glob: .github/**/*.{yml,yaml}` → no matches).
- Deployment is wired through **Cloudflare Workers Builds** in the Cloudflare dashboard, not in-repo. The dashboard's "Deploy command" is set to `npm run build && npx wrangler deploy` (per HANDOFF §13). Auto-deploys on `git push origin main`.
- No preview environments, no PR gating workflow, no test workflow.

## Observability

- **Logging**: `console.log` / `console.error` only — sent to Cloudflare's Workers logging surface (visible via `wrangler tail`). No structured logging library.
- **Error tracking**: none. No Sentry, no Honeybadger, no Datadog, no Cloudflare Workers Logpush configured in `wrangler.toml`.
- **Analytics**: no analytics SDK in [package.json](package.json) or [src/](src/).
- **Audit trail**: in-app `audit_log` table, written from many handlers and from the cron in `worker/index.js:573-588`. Most reliable observability surface today.

## Cron / scheduled jobs

Single trigger `*/15 * * * *` ([wrangler.toml:27](wrangler.toml)) maps to `scheduled()` in [worker/index.js:554-595](worker/index.js). On every fire it runs three sweeps in parallel and **always** writes a `cron.swept` row to `audit_log` regardless of whether work was done — this is what `/api/admin/analytics/cron-status` reads to render the AdminDashboard CronHealth widget.

| Sweep | Window | Sentinel column | What it does | Code |
|---|---|---|---|---|
| 24hr reminder | event in 20–28 hrs | `bookings.reminder_sent_at` | Sends `event_reminder` template; logs `reminder.sent` | [worker/index.js:209-215](worker/index.js), `runReminderSweepWindow` |
| 1hr reminder | event in 45–75 min | `bookings.reminder_1hr_sent_at` | Sends `event_reminder_1hr` template; logs `reminder_1hr.sent` | [worker/index.js:216-222](worker/index.js) |
| Abandon pending | bookings >30 min in `pending` | n/a (status flip) | UPDATE bookings SET status='abandoned' | [worker/index.js:397-406](worker/index.js) |
| Vendor COI 30d | COI expires in <30 days | `vendors.coi_reminder_30d_sent_at` | `vendor_coi_expiring` email | [worker/index.js:267-307](worker/index.js) |
| Vendor COI 7d | COI expires in <7 days | `vendors.coi_reminder_7d_sent_at` | `vendor_coi_expiring` email | [worker/index.js:308](worker/index.js) |
| Vendor pkg reminder | event in 6–8 days, status `sent`, never viewed | `event_vendors.package_reminder_sent_at` | `vendor_package_reminder` email | [worker/index.js:312-346](worker/index.js) |
| Vendor signature reminder | event in 13–15 days, contract required, unsigned | `event_vendors.signature_reminder_sent_at` | `vendor_signature_requested` email | [worker/index.js:350-386](worker/index.js) |

All sweeps use a sentinel-first idempotency pattern: stamp the column to `Date.now()` BEFORE sending, roll back to NULL on failure. Survives Worker eviction at the cost of at most one skipped delivery.

## Worker-level handlers (not API routes)

- **`/api/*`** → Hono `app.fetch()` ([worker/index.js:533-535](worker/index.js))
- **`/uploads/:key`** → R2 stream with allowlist regex on key shape (`<prefix>/<random>.<ext>`) and ext-derived MIME (rejects `httpMetadata.contentType`) ([worker/index.js:415-440](worker/index.js))
- **`/events/:slug`** → fetches SPA shell + `HTMLRewriter` injects per-event `<title>`, `<meta name="description">`, and `og:*` / `twitter:*` tags ([worker/index.js:443-507](worker/index.js)). Falls through to SPA shell if event not found.
- **everything else** → `env.ASSETS.fetch(request)` (SPA shell) ([worker/index.js:545](worker/index.js))
- **All responses** wrapped with `withSecurityHeaders` (HSTS, X-CTO, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy: camera=self for `/admin/scan`) ([worker/index.js:516-529](worker/index.js)). **CSP is intentionally absent** — comment at line 510-515 says it's deferred until the Peek widget is removed (Peek already gone per HANDOFF §10 row "Booking flow cutover", so this comment is stale; flag for Area 8).

## Dev / build / lint commands

```bash
# Dev (Vite, /api proxies to deployed Worker)
npm run dev

# Build (Vite → dist/)
npm run build

# Lint (BROKEN today — no eslint config file)
npm run lint

# Preview built dist
npm run preview
```

Deploy is **not** an npm script — it's:

```bash
npm run build && source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler deploy
```

(The skill at [.claude/skills/deploy-air-action-sports/SKILL.md](.claude/skills/deploy-air-action-sports/SKILL.md) wraps this.)

## Repo-root file inventory (non-src, non-config)

These exist alongside the codebase and are worth flagging because they may be confusing or stale:

- `AAS_FAQ_Review_Draft.docx` — operator-facing doc
- `AAS_Release_of_Liability_v1.0.docx` — original waiver source (waiver text now lives in `waiver_documents` D1 rows, currently `wd_v4`)
- `Air-Action-Sports-Owner-Review-Checklist.docx` — operator-facing
- `generate_waiver.py` — Python script that builds the waiver `.docx`
- `placeholder_guide.txt`, `readme_md.txt` — pre-deployment text files; superseded by `HANDOFF.md`
- `SECURITY_AUDIT.md` — prior security audit output (not yet read in this audit; flag in Area 4 / Area 6)
- `static-backup/` — gitignored; legacy static-site assets pre-React rewrite
- `robots.txt` and `sitemap.xml` at repo root **and** at `public/`. The `public/` versions are what Vite copies into `dist/`. The root copies are dead.
- `tools/cover-banner-builder.html` — standalone HTML tool for designing 1200×630 covers
- `scripts/*.sql` and `scripts/*.cjs` — one-off SQL scripts and one CJS waiver build script. Not run by migration runner. Many are clearly stale (`triage_fb_*`, `cleanup_smoke_test_*`).

## Open questions logged from Area 1 (forwarded to [10-open-questions.md](10-open-questions.md))

- ESLint config is missing — was it deleted accidentally, or was lint never set up?
- Is `docx` actually used at runtime in any frontend or worker code, or only by `scripts/build_waiver_v2.cjs`? (If only the script, it should be a devDep, not a runtime dep.)
- Two migrations numbered `0010` — was this an intentional rebase artifact or unnoticed merge collision?
- Is the stale CSP comment at [worker/index.js:510-515](worker/index.js) a leftover TODO?
