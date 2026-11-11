---
name: event-content
description: "Use when adding or editing an Air Action Sports event's data-driven page content (events.details_json), uploading or replacing event images in R2, setting image focal points, or linking Google Forms and required documents."
---

Moved from CLAUDE.md on 2026-10-28.

## Event-content session — 2026-06-02 (Volga + Foxtrot)

Operator-driven content build for two live events + the reusable per-event rendering behind it. **PRs #254/#255/#256/#257 merged to `main`; PR #1 closed.** `main` HEAD `8adc7ae` (incl. the follow-on #259 "Volga Flank" rename). Tests unchanged at **2744 / 217** (JSX + data only — no new unit tests; CI's two visual-regression suites cover the public render). **No migrations. No marketing/M7/M6 surfaces touched — operator-pending is UNCHANGED.**

| PR | What |
|---|---|
| #254 (merged) | Removed stale "Coming in M5/M6" persona-dashboard placeholder tiles |
| #1 (CLOSED) | A stale Cloudflare-bot PR that would rename the Worker `air-action-sports`→`action-air-sports` and break production deploys — closed, not merged |
| **#255** (merged) | **Per-event data-driven detail pages** — `src/hooks/useEvents.js` (`adaptEvent` forwards `event.details`) + `src/pages/EventDetail.jsx` (game-mode label / Rules / Schedule / Required Documents / Mission Briefing / Terrain / sidebar FPS / collab banner — each `event.details?.X` with the hardcoded content as fallback) + `src/pages/Booking.jsx` (inline per-faction registration link from `details.factionLinks`). DNT untouched (`formatEvent` / `bookings.js` / `pricing.js` / `stripe.js`). |
| #256 (merged) | Audit SQL for the 3 Volga images uploaded to R2 |
| #257 (merged) | Audit SQL for the Bolotnik (RUSFOR) registration link |

**Production data/asset changes** (operator-authorized; applied directly to remote D1 + R2, audited in `scripts/update-*.sql`):
- **Cleanup:** cleared 3 test bookings (2 refunded + 1 abandoned) + their attendees/waivers/customers; fixed the foxtrot title typo ("Warefare"→"Warfare") + empty slug (→ `foxtrot-jungle-warfare`).
- **Foxtrot** (`foxtrot-vietnam`): time → `7:00 AM – 2:00 PM` + `display_date` fix.
- **Volga Flank** (`volga-initiative`; renamed from "Volga Initiative" → slug `volga-flank`, id unchanged — `scripts/update-volga-rename.sql`): full `details_json` content + `custom_questions_json` faction select (Kraken/Bolotnik, required) + quick-facts + 3 R2 images (hero/card/logos) + Bolotnik RUSFOR link.

**Durable lessons** (future event-content work — full how-to in memory `event-content-data-driven.md`):
1. **Events are content-drivable via `events.details_json`** — `formatEvent` (DNT) already passes it through; `adaptEvent` (the subset the public pages read, `src/hooks/useEvents.js`) now forwards it. Render `event.details?.X || <hardcoded default>` so events without it stay byte-identical. The admin event form does NOT send `details`, so a D1-set `details_json` SURVIVES admin saves (patch one field with `json_set`). `custom_questions_json` IS managed by the form.
2. **Booking faction selector = a plain `select` custom question** (zero code); the **inline per-faction link** reads `details.factionLinks[<selected option>]` — kept in `details_json` (not on the question) so it survives admin re-saves.
3. **Upload event images to R2 without an admin session:** `wrangler r2 object put air-action-sports-uploads/events/<name>.<ext> --file "<path>" --content-type image/<ext> --remote` (deploy token has R2 access — verify via `wrangler r2 bucket list`). serveUpload (`worker/index.js`) allowlist requires key `<prefix>/<name>.(jpg|jpeg|png|webp|gif)`; URL = `/uploads/<key>`. Can't read chat-pasted images — operator saves files to disk first.
4. **Google Forms:** a `/edit` URL is the OWNER link (players hit a permission wall); use the public `/forms/d/e/<pubid>/viewform` (or a `forms.gle/…` short link — only the form OWNER can mint it via Send → Shorten URL). Convert `/edit`→`/viewform` and curl-verify it returns 200 publicly.
5. **Replacing an event image = a NEW content-hashed key + repoint the D1 `*_image_url` column, NOT an in-place overwrite.** `serveUpload` serves `/uploads/*` with `Cache-Control: public, max-age=31536000, immutable`, so overwriting the same key won't reach already-visited browsers (no revalidation for ~1yr) or the Cloudflare CDN edge — the `r2 object put` returns OK but users keep seeing the old image. Upload under `<name>-<sha256[:12]>.<ext>`, `UPDATE` the column (reversible), and leave the old object **orphaned — don't hard-delete casually** (its bytes are the only copy; the operator hands you the *new* file). Verify integrity without downloading: R2 ETag == the uploaded file's MD5. Verified 2026-06-02 refreshing the Volga Flank hero → `volga-hero-be1eee1d2f74.jpg` (D1 repointed; PR [#261](https://github.com/bulletbiter99/air-action-sports/pull/261); old `volga-hero-3dfe99d37edd.jpg` left orphaned).

---

## Image focal-point positioning + data-driven Locations session — 2026-06-02

Feature session resolving feedback `fb_Su6LWtWJz2FI` ("position uploaded images for best visibility — see the Ghost Town image"). **9 batches, 4 PRs (#263–#266) all merged + deployed.** Tests **2744 → 2776 / 220**, build clean, 0 lint errors. Full how-to in memory `image-focal-positioning.md`; current state + the ⚠️ out-of-band migration note in [docs/next-session.md](docs/next-session.md).

| PR | Batch | What |
|---|---|---|
| #263 | A1+A2 | migration 0071 (`events.*_image_position`) + reusable `src/components/admin/ImageFocalPicker.jsx` (drag focal point + cropped preview + a11y nudge; 15 tests) |
| #264 | A3+A4 | event positioning end-to-end — `parseEventBody`/`formatEvent` (+ `normalizeImagePosition` sanitizer) + `EventImagePicker` integration + public render swap (card/hero/banner → `var(--*-image-position, center)`); 9 tests |
| #265 | B1+B2 | migration 0072 (sites public-content cols) + seed + public `GET /api/sites` + admin `formatSite`/`parseSiteBody` extension; 8 tests |
| #266 | B3+B4 | `AdminSiteDetail` "Locations page content" editor (2nd picker consumer) + data-driven `/locations` (`useSites` hook); Home preview left static |

**Durable lessons:**
1. **Mirror the `*_overlay_opacity` precedent for any per-image setting** — column → `parseEventBody` → `formatEvent` (DNT, additive) → CSS var; a default keyword (`center`) keeps untouched images byte-identical. The same shape ports to sites (`photo_position`).
2. **Image-position values render into inline styles → sanitize server-side.** `normalizeImagePosition` (exported from `worker/routes/admin/events.js`, reused by `admin/sites.js`) coerces to strict `"x% y%"`/null and rejects CSS-injection.
3. **⚠️ Out-of-band migration apply (0071/0072).** Because the next-pending migrations 0065–0070 are deliberately deferred (Marketing/M7), running `wrangler d1 migrations apply` would also apply them. Instead: `d1 execute --file` the ALTERs, then `INSERT INTO d1_migrations (name) VALUES ('00NN_*.sql')` so the runner skips it. Leaves `d1_migrations` out-of-order (0064 → 0071, 0072 — harmless). Operator chose this over un-deferring marketing/M7.
4. **A faithful static→D1 rewrite keeps the visual baseline green** — seed the D1 content to mirror exactly what the static page rendered (features = the old `fullFeatures`, same photos, `center`), so `/locations`'s public visual-regression baseline passes unchanged.
5. **Home's locations preview uses a different card shape** (`cardLabel`/`photoClass` via CSS classes) than `/api/sites`, and the home page is in the visual baseline — left static (`src/data/locations.js` NOT retired) to avoid disproportionate churn. Only `/locations` (the feedback target) went data-driven.

**Operator-pending UNCHANGED** — 0065–0070 + the M6/M7/Marketing items are all untouched.

---
