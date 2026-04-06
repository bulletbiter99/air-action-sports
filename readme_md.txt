# Air Action Sports — Landing Page

## Project Overview
**Business:** Air Action Sports  
**Type:** Single-page marketing/landing site  
**Stack:** Plain HTML + CSS + Vanilla JavaScript (no frameworks, no build tools)  
**Aesthetic:** Dark military/tactical — olive, tan, charcoal palette with orange accents  
**Purpose:** Market airsoft and paintball game events across multiple outdoor property sites  
**Target Audience:** Airsoft and paintball enthusiast community — casual players to serious milsim veterans

---

## File Structure
```
air-action-sports/
├── index.html           ← Entire site (HTML + CSS + JS in one file)
├── README.md            ← This file
├── placeholder-guide.txt ← Quick-reference checklist of all placeholders
└── images/
    ├── YOUR-HERO-IMAGE.jpg       ← Hero section full-bleed background
    ├── YOUR-SITE-1-IMAGE.jpg     ← Delta Base location card photo
    ├── trench-warfare.jpg        ← Trench Warfare (Echo Urban) location card photo
    ├── YOUR-SITE-3-IMAGE.jpg     ← Foxtrot Fields location card photo
    ├── YOUR-GALLERY-1.jpg        ← Gallery mosaic photo 1 (wide)
    ├── YOUR-GALLERY-2.jpg        ← Gallery mosaic photo 2
    ├── YOUR-GALLERY-3.jpg        ← Gallery mosaic photo 3
    ├── YOUR-GALLERY-4.jpg        ← Gallery mosaic photo 4
    └── YOUR-GALLERY-5.jpg        ← Gallery mosaic photo 5 (wide)
```

---

## Page Sections (in order)

| Section | ID / Class | Description |
|---|---|---|
| Navigation | `<nav>` | Fixed top bar with logo, nav links, Book Now CTA |
| Hero | `.hero` | Full-bleed photo background, headline, stats, dual CTAs |
| Countdown Timer | `.countdown-band` | Live real-time countdown to next major event |
| About | `#about` | Brand story + 4 feature highlight cards |
| Game Types | `#games` | 3 cards: Airsoft, Paintball, Mixed Events |
| Locations | `#locations` | 3 site cards with photo headers and feature lists |
| Gallery | `#gallery` | 5-photo mosaic grid showcasing site terrain |
| Upcoming Events | `#events` | Event cards with date, type, time, slots, price, CTA |
| Why Choose Us | `.why-grid` | 6 differentiator items |
| Testimonials | `.testimonials` | 3 player review cards |
| CTA Band | `.cta-band` | Full-width orange call-to-action strip |
| Footer | `#contact` | Links, newsletter signup, social icons, copyright |

---

## How to Add Your Photos

All images live in the `/images/` folder. The site uses CSS `background-image` for all photos.

### Hero Background
In `index.html`, find the CSS rule for `.hero-bg-photo`:
```css
.hero-bg-photo {
    background-image: url('images/YOUR-HERO-IMAGE.jpg');
}
```
Replace `YOUR-HERO-IMAGE.jpg` with your actual filename.  
**Recommended size:** 1920×1080px minimum. Landscape orientation.  
**Overlay:** Dark overlay is applied automatically via `::after` pseudo-element (opacity `0.78`). Increase the alpha value to darken, decrease to lighten.

### Location Card Photos
Find these CSS classes and replace the filenames:
```css
.loc-photo-placeholder       { background-image: url('images/YOUR-SITE-1-IMAGE.jpg'); } /* Delta Base */
.loc-photo-placeholder.site2 { background-image: url('images/trench-warfare.jpg'); } /* Trench Warfare */
.loc-photo-placeholder.site3 { background-image: url('images/YOUR-SITE-3-IMAGE.jpg'); } /* Foxtrot Fields */
```
**Recommended size:** 800×400px minimum. Landscape orientation.

### Gallery Photos
Find these CSS classes and replace the filenames:
```css
.g1 { background-image: url('images/YOUR-GALLERY-1.jpg'); } /* Wide tile — spans 2 columns */
.g2 { background-image: url('images/YOUR-GALLERY-2.jpg'); }
.g3 { background-image: url('images/YOUR-GALLERY-3.jpg'); }
.g4 { background-image: url('images/YOUR-GALLERY-4.jpg'); }
.g5 { background-image: url('images/YOUR-GALLERY-5.jpg'); } /* Wide tile — spans 2 columns */
```
**Recommended size:** 1000×600px minimum. Action shots work best.

---

## How to Update the Countdown Timer

In `index.html`, find this line near the bottom in the `<script>` block:
```javascript
const COUNTDOWN_TARGET = new Date('2026-04-19T09:00:00');
```
Change the date/time string to your next major event. Format: `YYYY-MM-DDTHH:MM:SS`

Also update the event name label in the HTML:
```html
<div class="countdown-event-name">Operation Nightfall — Delta Base, Apr 19</div>
```

---

## Design Tokens (Global Theme)

All colors are defined as CSS variables at the top of the `<style>` block:
```css
:root {
    --olive: #4a5240;
    --olive-dark: #2c3127;
    --olive-light: #6b7560;
    --tan: #c8b89a;
    --tan-light: #e8dcc8;
    --orange: #d4541a;       /* Primary accent */
    --orange-dark: #a83e12;  /* Hover state */
    --cream: #f2ede4;        /* Body text */
    --dark: #1a1c18;         /* Page background */
    --mid: #2e3229;          /* Alternate section background */
}
```
To retheme the site, only these variables need to change.

---

## Suggested Next Features for Claude Code

These are ready to build — just ask Claude Code:

- [ ] **Mobile hamburger menu** — nav links are hidden on mobile, needs a toggle menu
- [ ] **Contact / enquiry form** — name, email, event type, group size, message
- [ ] **Booking integration** — link Book buttons to a booking platform (e.g. Bookwhen, SimplyBook, custom form)
- [ ] **Newsletter form backend** — connect newsletter input to Mailchimp or similar
- [ ] **Social media links** — update placeholder URLs in footer social icons
- [ ] **FAQ accordion section** — expandable Q&A for common questions
- [ ] **Lightbox gallery** — click gallery photos to view full-size
- [ ] **Google Maps embed** — add map to each location card
- [ ] **Waiver / check-in page** — separate page for player waivers
- [ ] **Events archive** — past events page with photos

---

## GoDaddy Deployment (FTP)

### Step 1 — Get FTP credentials from GoDaddy
1. Log in to GoDaddy → My Products → Web Hosting → Manage
2. Go to **cPanel** → **FTP Accounts** → note your FTP username, password, and server hostname

### Step 2 — Upload files
Using **FileZilla** (free FTP client):
1. Open FileZilla → File → Site Manager → New Site
2. Enter: Host = your FTP hostname, Protocol = FTP or SFTP, User/Password from Step 1
3. Connect → navigate to `public_html/` on the remote side
4. Drag your entire project folder contents into `public_html/`
   - `index.html` must be at the root of `public_html/`
   - `images/` folder goes inside `public_html/`

### Step 3 — Verify
Visit your GoDaddy domain in a browser. The site should load immediately.

### For updates
Only re-upload the files you changed. If you updated `index.html`, just drag and drop the new version over the old one in FileZilla. Images only need uploading once unless you replace them.

---

## Notes for Claude Code

- All HTML, CSS, and JS is in a single `index.html` file — intentional for simple GoDaddy hosting
- No npm, no build step, no frameworks — open `index.html` in a browser to preview instantly
- All `<!-- PLACEHOLDER: ... -->` comments mark items needing real content before going live
- The `images/` folder must exist even if empty — add a `.gitkeep` file if using Git
- Social icon `onclick` handlers use `openLink()` — replace with standard `<a href>` tags if preferred
