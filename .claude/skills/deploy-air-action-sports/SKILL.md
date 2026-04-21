---
name: deploy-air-action-sports
description: Build and deploy the Air Action Sports Worker to Cloudflare, then verify /api/health returns ok. Handles the Cloudflare API token from .claude/.env, runs the Vite build, invokes wrangler deploy, and confirms the deploy is live. Trigger whenever the user says "deploy", "ship it", "push to production", "redeploy", "update the live site", "push the change", or any variant indicating they want the current working tree's changes live on air-action-sports.bulletbiter99.workers.dev. Also trigger proactively after a completed code change when the user mentions wanting to see it live.
---

# Deploy Air Action Sports

## When to use

Trigger whenever the user wants the current codebase changes live on Cloudflare. Typical phrases: "deploy", "ship it", "redeploy", "push to prod", "update the live site", "can you deploy that", "get that live". Also trigger when the user completes a feature and asks to "see it" — they usually mean live, not local dev.

Do NOT trigger for:
- Just running the Vite build (no deploy needed)
- Applying D1 migrations (that's `wrangler d1 migrations apply`, not a code deploy)
- First-time setup (that needs secrets + bindings configured manually)

## What it does

1. Build the React frontend with Vite (`npm run build`)
2. Load the Cloudflare API token from `.claude/.env`
3. Invoke `wrangler deploy` (uploads Worker + `dist/` static assets in one shot)
4. Verify `curl https://air-action-sports.bulletbiter99.workers.dev/api/health` returns `{"ok":true,...}`
5. Report the new version ID and a one-line status to the user

## Command

Run in a single Bash call so shell state (the sourced env) persists:

```bash
npm run build && source .claude/.env && CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler deploy
```

Then separately verify health:

```bash
curl -s https://air-action-sports.bulletbiter99.workers.dev/api/health
```

## Expected output

A successful deploy ends with something like:

```
Uploaded air-action-sports (6.59 sec)
Deployed air-action-sports triggers (0.96 sec)
  https://air-action-sports.bulletbiter99.workers.dev
  schedule: */15 * * * *
Current Version ID: <uuid>
```

Health check should return `{"ok":true,"ts":<unix-ms>}`.

Report to the user: new version ID + confirmation that health is green.

## Things to know

- **Do not skip the build.** Wrangler uploads `dist/` as static assets. If you skip `npm run build` you ship the previous build's frontend with the new Worker code — silent mismatch.
- **The `&&` chain matters.** A `;` would plow through a build failure and deploy broken code. `&&` is the safety net.
- **`.claude/.env` must be sourced in the same shell call as `wrangler deploy`.** `source X; next-command` in a fresh Bash invocation each time will lose the var. Chain with `&&`.
- **Don't push to git.** This skill only deploys; committing is a separate decision. If the user wants both, they'll ask for both.
- **Don't flip Stripe keys.** Stripe sandbox-to-live is a separate, destructive operation requiring explicit confirmation. This skill never touches `wrangler secret put`.

## If something fails

- **Build fails** → read the error, fix the source, re-run. Don't deploy a half-built dist.
- **Token error from wrangler** (`Authentication error: [code: 10000]`) → `.claude/.env` wasn't sourced correctly. Verify the file exists and has `CLOUDFLARE_API_TOKEN=...` on one line.
- **Deploy succeeds but health fails** → the Worker is up but errored at startup. Check `npx wrangler tail` in another terminal for the actual exception, then roll back with `npx wrangler rollback` if it's serious.
- **Migration needed** → if the new code references a column that doesn't exist yet, apply the migration first: `CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN npx wrangler d1 migrations apply air-action-sports-db --remote`. Then redeploy.

## Why it's structured this way

This is a project-specific skill because the `.claude/.env` dance and the exact Worker name are local to this repo. Generalizing it to any CF Worker would lose the specifics that make it one-command. If you start a second Worker project, copy this skill and edit the name + health URL.
