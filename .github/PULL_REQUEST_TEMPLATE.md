<!--
  Default PR template. Delete sections that don't apply.
  Full conventions in CONTRIBUTING.md and CLAUDE.md.
-->

## Summary

<!-- 1-3 sentences. What changes, why, and (if non-obvious) the constraint that drove the approach. -->

## Audit map

<!-- For milestone test batches: which audit items this PR closes. Link to docs/audit/09-test-coverage.md. Delete this section if not applicable. -->

| Audit ID | Description | File / function locked |
|---|---|---|
|  |  |  |

## Test plan

<!-- Check off what you ran. Add new boxes for anything PR-specific. -->

- [ ] `npm test` passes locally (vitest)
- [ ] `npm run test:coverage` reviewed (no surprising drops in covered files)
- [ ] If touching public-route HTML: `npm run test:e2e` against staging or prod
- [ ] If touching D1 schema: migration applied to a sandbox DB before merge
- [ ] No live Stripe / Resend / wrangler deploy ran from automation

## Acceptance checklist

- [ ] **≤10 files** in this PR (M1 cap; counts generated files like `package-lock.json`)
- [ ] No `--force` push, no rebase on a shared branch, no direct commits to `main` or any `milestone-*` branch
- [ ] Commit messages follow Conventional Commits with scope (`type(scope): summary`)
- [ ] No edits to entries in [docs/audit/06-do-not-touch.md](../docs/audit/06-do-not-touch.md) without an explicit follow-up conversation
- [ ] No new secrets, credentials, or `.env` values committed
- [ ] If non-trivial: a plan was posted and `proceed` was given before editing started

## Reviewer notes

<!-- Anything the reviewer should look at first. Link to specific lines if helpful: [foo.js:42](path/foo.js#L42) -->
