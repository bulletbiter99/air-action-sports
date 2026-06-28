# Image focal-point crop fix + "title below cover" toggle (2026-06-28)

Resolved an operator report that admin focal-point picker previews did not match
the live cropped images across the site.

## Root cause
The `ImageFocalPicker` previews a `cover` crop at a fixed per-surface aspect
ratio, but the live surfaces did not match it: the events card + /locations
photo used a fixed pixel height (ratio drifted), and the event hero + booking
banner rendered the whole image (`contain`) with the focal value only on an
invisible blurred backdrop.

## Fixes (PR #343 — `fix(images): crop public image surfaces to match the admin focal point`)
- Events card (`events.css`): `height:160px` → `aspect-ratio: 2/1`.
- Locations photo (`locations.css`): `height:280px` → `aspect-ratio: 16/9`.
- Event hero (`event-detail.css`): visible layer `contain`+center → `cover` +
  `var(--hero-image-position)`, pinned `3.2/1` (+ min-height), blur backdrop dropped.
- Booking banner (`booking.css`): same, pinned `4/1`.
- Home previews (`Home.jsx` + `home.css`): apply the matching DB site focal
  point (matched by photo URL) + `aspect-ratio: 16/9`.

## Title-below toggle (PR #344 — `feat(events): title-below-cover-image layout toggle`)
For text-heavy POSTER cover art, cropping put the page title on top of the
poster's own title. Added a per-event toggle (`events.details_json` →
`details.coverTextBelow`; no migration) to render the title/info in a clean
block BELOW the cropped cover image, on the event hero + booking banner.
Admin: a checkbox in the "Detail page content" editor. Default = overlay.
Operation Last Light flipped on (`scripts/set-operation-last-light-text-below.sql`).

Both verified on desktop + mobile (live prod). 3051 tests green.
