# Contributing to Air Action Sports

This file is the single-source contributor guide. Operating rules originally lived only in [CLAUDE.md](CLAUDE.md) and [docs/audit/](docs/audit/); this surfaces them for human contributors and AI sessions alike.

If you're an AI session, read [CLAUDE.md](CLAUDE.md) first for the canonical rules — this file mirrors the same conventions in human-readable form.

---

## Quick start

```bash
git clone https://github.com/bulletbiter99/air-action-sports.git
cd air-action-sports
npm install
npm run dev          # Vite serves src/ at http://localhost:5173, /api/* proxies to the deployed Worker
```

Build + preview:

```bash
npm run build        # vite build → dist/
npm run preview      # serve dist/ locally
```

---

## Branching model

| Branch | Purpose | PRs allowed from |
|---|---|---|
| `main` | Production. Auto-deployed via Cloudflare Workers Builds. | Reviewed PRs only — no direct commits, no force-push, ever. |
| `milestone-N-<slug>` | Long-lived integration branch for a milestone (e.g. `milestone-1-test-infrastructure`). Squash-merged into `main` at milestone close. | Sub-batch branches only — see below. |
| `m1-batch-N-<slug>` | Short-lived feature branch for a single batch within a milestone (e.g. `m1-batch-7-ci`). | Off the milestone branch. Squash-merged back into the milestone branch as one commit. |
| `audit/...`, `docs/...`, `feat/...`, etc. | Ad-hoc feature branches off `main`. | Reviewed PRs only — no direct commits. |

### Hard rules

- **Never** force-push to `main` or any `milestone-*` branch.
- **Never** rebase a shared branch (a branch others have based work on).
- **Never** commit directly to `main` or any `milestone-*` branch — always go through a PR.
- **Never** skip git hooks (`--no-verify`) or signing flags unless explicitly requested by the operator.
- **Never** use interactive git commands (`rebase -i`, `add -i`) — they require an editor that AI sessions can't drive.

---

## Commit conventions

The repo uses **Conventional Commits with an optional scope**:

```
type(scope?): short summary in the imperative

Optional body explaining the why.

Co-Authored-By: <if applicable>
```

Types observed in `git log`: `feat`, `fix`, `docs`, `audit`, `polish`, `ship`, `tools`, `config`, `security`, `test`, `chore`. New types are fine if they accurately describe a class of change. Scope is whatever subsystem is touched (e.g. `events`, `handoff`, `quote`, `m1-ci`).

Commit messages should be **descriptive enough that a future session can rebuild the mental model from history alone.** Treat the commit log as durable documentation.

---

## Pull request rules

### M1-specific (active until milestone-1 closes)

- **10-file cap per PR.** Hard rule. Includes generated files (e.g. `package-lock.json`).
- **Plan-mode-first for non-trivial changes.** Write the plan, post it, wait for `proceed` before editing.
- **Stop and ask** if a do-not-touch entry from [docs/audit/06-do-not-touch.md](docs/audit/06-do-not-touch.md) appears to need editing, or if a test reveals current behavior conflicting with audit-documented behavior.
- **No live D1 / Stripe / Resend** from automation — all unit tests use mocks.
- **No `wrangler deploy`** from automation — deploy is operator-triggered.

### General

- Open the PR against the correct base — typically `main` for feature work, the active milestone branch for milestone batches.
- Use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md) — it scaffolds a Summary / Audit map / Test plan / Acceptance checklist.
- Squash-merge milestone batches; the squash commit message should match the PR title.

---

## Testing

| Command | What it runs | When to run |
|---|---|---|
| `npm test` | Vitest unit suite (216 tests as of m1-batch-7-ci) | Before every commit; CI runs this on every PR. |
| `npm run test:watch` | Vitest in watch mode | Active development. |
| `npm run test:coverage` | Vitest run + v8 coverage report (HTML in `coverage/`) | Before opening a PR; CI runs this and uploads the report as an artifact. |
| `npm run test:e2e` | Playwright smoke suite (7 tests against a deployed Worker) | Operator-triggered after a deploy. **Not** part of `npm test`. **Not** in CI by default. |

### Playwright operator setup (one-time)

```bash
npx playwright install chromium     # downloads ~150 MB Chrome binary
```

Run the smoke suite:

```bash
npm run test:e2e                                                   # hits the production deploy
BASE_URL=https://staging.example.com npm run test:e2e              # hits a staging deploy
E2E_TEST_EVENT_SLUG=ops-night npm run test:e2e                     # un-skips audit smoke #79 (per-event OG title)
```

### Lint

`npm run lint` is **currently broken**. ESLint 9 + plugins are declared in `package.json` but no `eslint.config.js` exists. See [docs/audit/08-pain-points.md](docs/audit/08-pain-points.md) #8. CI runs lint with `continue-on-error: true` so the gap stays visible in every PR run without blocking merges.

Fix is a separate task — not part of M1.

---

## Test directory layout

```
tests/
├── helpers/                    # mock D1, Stripe, Resend, env, fixtures
│   ├── mockD1.js
│   ├── mockEnv.js
│   ├── mockResend.js
│   ├── mockStripe.js
│   ├── stripeSignature.js
│   ├── webhookFixture.js
│   └── waiverFixture.js
├── setup.js                    # global vitest setup (throw-on-unmocked fetch)
├── unit/                       # vitest scope; matches tests/unit/**/*.test.js
│   ├── auto-link/              # findExistingValidWaiver
│   ├── pricing/                # calculateQuote
│   ├── waiver/                 # POST /api/waivers/:qrToken + GET path
│   └── webhook/                # /api/webhooks/stripe + handlers
└── e2e/                        # Playwright scope; excluded from vitest
    ├── setup.js
    └── smoke.test.js
```

Conventions:
- All vitest tests under `tests/unit/<group>/*.test.js`. E2E under `tests/e2e/`.
- Helpers in `tests/helpers/`.
- `globalThis.fetch` defaults to throw-on-unmocked in `tests/setup.js`. Tests opt in via `mockStripeFetch()` or `mockResendFetch()`.
- `mockD1.__on(pattern, response, kind)` registers a handler. `pattern` is a string-includes substring or RegExp.

---

## Where to find more

- [CLAUDE.md](CLAUDE.md) — canonical project rules (mirrored above for humans).
- [HANDOFF.md](HANDOFF.md) — full session-start context: stack, deploy, schema, API surface, completed phases, gotchas.
- [docs/audit/](docs/audit/) — Phase 1 audit; start at [00-overview.md](docs/audit/00-overview.md).
- [docs/audit/06-do-not-touch.md](docs/audit/06-do-not-touch.md) — Critical / High / Medium tier files, functions, endpoints, and tables that require coordinated review.
- [docs/audit/09-test-coverage.md](docs/audit/09-test-coverage.md) — the 83 prescribed characterization tests and the milestone-1 plan that's implementing them.
