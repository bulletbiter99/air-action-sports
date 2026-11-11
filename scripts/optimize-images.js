#!/usr/bin/env node
/**
 * optimize-images.js — optimize the static photos in public/images/ and
 * generate responsive AVIF/WebP derivatives.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured 2026-11-10: public/images/ held 8,064 kB across 13 files with zero
 * WebP/AVIF and zero responsive variants. `ghost-town.jpg` alone was 3,701 kB
 * at 4080x3072 — rendered into a 16:9 card roughly 450 CSS px wide, so ~9x
 * larger than any display needed. That one file dominated mobile LCP.
 *
 * ⚠ THE NON-OBVIOUS PART — READ BEFORE CHANGING ANYTHING
 * ------------------------------------------------------
 * The home-page site cards do NOT get their photo from CSS. They render
 * `sites.photo_url` out of D1, and those rows point at the ORIGINAL paths:
 *
 *     ghost-town      -> /images/ghost-town.jpg
 *     trench-warfare  -> /images/trench-warfare.jpg
 *     foxtrot         -> /images/foxtrot-fields.jpeg
 *
 * The `.loc-photo-placeholder` CSS rules are only the fallback for a site with
 * no photo set. So adding derivatives and repointing the CSS does NOT speed up
 * what production actually serves — verified in a browser, where the 3,701 kB
 * original was still being requested after the CSS was updated.
 *
 * Hence IN_PLACE below: those three files are rewritten AT THE SAME PATH, so
 * the existing D1 rows serve an optimized file with no database mutation and
 * no broken reference. Pristine full-resolution copies are preserved under
 * assets/source-images/ (committed, but NOT deployed — Vite only copies
 * public/), which is also what every resize reads from, so re-running is
 * idempotent and never compounds generational loss.
 *
 * A plain `.avif` URL in D1 would save another ~50 kB but would break Safari
 * before 16, which has no AVIF support and no fallback in a bare url — so the
 * in-place files stay in their original format.
 *
 * HOW IT IS USED
 * --------------
 *   node scripts/optimize-images.js            # optimize + write derivatives
 *   node scripts/optimize-images.js --check    # report only, write nothing
 *
 * Derivatives are written as `<base>-<width>.<ext>` and committed, so the
 * Cloudflare build stays a plain `vite build` with no image step and no
 * deploy-time dependency on sharp.
 *
 * Sizes below are derived from real display contexts:
 *   .hero-bg-photo          full-viewport hero (background-size: contain/cover)
 *   .loc-photo-placeholder  16:9 card in minmax(300px, 1fr) grid → ~450 CSS px
 *   .gallery-photo / .g1-5  220px-tall grid rows (180px under 768px)
 *   Gallery.jsx lightbox    background-size: contain, near-fullscreen
 */

import sharp from 'sharp';
import { readFile, writeFile, mkdir, copyFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';

const IMAGES_DIR = path.join(process.cwd(), 'public', 'images');
const SOURCE_DIR = path.join(process.cwd(), 'assets', 'source-images');
const CHECK_ONLY = process.argv.includes('--check');

// AVIF at 50 is visually comparable to WebP at ~78 for photographic content
// while landing materially smaller.
const AVIF = { quality: 50, effort: 6 };
const WEBP = { quality: 78 };
const JPEG = { quality: 80, mozjpeg: true };

/**
 * Files rewritten at their existing path because something outside this repo
 * points at that exact URL (D1 `sites.photo_url`, or social scrapers).
 * Format is preserved — only dimensions and compression change.
 */
// The three site photos land in a 16:9 card ~450 CSS px wide, so ~900px of
// WIDTH is what a 2x screen needs. They are NOT cropped to 16:9 here, because
// `sites.photo_position` (e.g. "52% 34%" on ghost-town) is a focal point the
// operator set against the FULL frame — cropping in the file would silently
// move it. Portrait sources therefore keep their tall aspect and pay for
// pixels the card crops away, which is why quality is a little tighter here.
const IN_PLACE = [
    { src: 'ghost-town.jpg', width: 900, quality: 76, why: 'D1 sites.photo_url -> ghost-town' },
    { src: 'trench-warfare.jpg', width: 900, quality: 76, why: 'D1 sites.photo_url -> trench-warfare' },
    { src: 'foxtrot-fields.jpeg', width: 900, quality: 76, why: 'D1 sites.photo_url -> foxtrot' },
    // Referenced by 15 page files, index.html and the worker's rewriteEventOg
    // (do-not-touch). Aspect ratio is preserved, so the preview does not crop.
    // Quality stays higher: this is the image every social share renders.
    { src: 'og-image.jpg', width: 1200, quality: 80, why: 'social preview — path must stay stable' },
];

/** Responsive derivative tiers. */
const MANIFEST = [
    {
        src: 'logo-hero-fallback.png',
        widths: [1024, 1920],
        fallbackWidth: 1920,
        // MUST stay PNG: this file has real transparency (alpha min 0, max 255,
        // mean 40/255 — a logo on a transparent field). A JPEG fallback would
        // flatten the alpha to a solid rectangle, which shows as a black box
        // over the `.hero-bg-photo--has-image` background (#1a1c18). AVIF and
        // WebP both carry alpha, so only the final fallback tier is affected.
        fallbackFormat: 'png',
        note: 'homepage hero fallback — LCP element when no event cover is set',
    },
    {
        src: 'ghost-town.jpg',
        widths: [500, 1000],
        fallbackWidth: 1000,
        note: 'site card placeholder (16:9) — source was 4080x3072 / 3,701 kB',
    },
    { src: 'trench-warfare.jpg', widths: [500, 1000], fallbackWidth: 1000, note: 'site card placeholder (16:9)' },
    { src: 'foxtrot-fields.jpeg', widths: [500, 1000], fallbackWidth: 1000, note: 'site card placeholder (16:9)' },
    // Gallery: 400/800 feed the grid cells, 1400 feeds the lightbox.
    // The 1400 tier is WebP-only on purpose — Gallery.jsx sets the lightbox
    // background from a React inline style, which cannot carry an image-set()
    // fallback declaration, so it requests a plain WebP url and an AVIF at
    // that width would ship unused. See the comment on `galleryItems`.
    ...['gallery-ghost-town-1', 'gallery-ghost-town-2', 'gallery-ghost-town-3',
        'gallery-foxtrot-1', 'gallery-foxtrot-2'].map((base) => ({
        src: `${base}.jpg`,
        widths: [400, 800, { w: 1400, formats: ['webp'] }],
        fallbackWidth: 800,
        note: 'gallery grid + lightbox',
    })),
];

const kb = (n) => `${Math.round(n / 1024)} kB`;
const exists = (p) => access(p).then(() => true, () => false);

/**
 * Return the pristine source path for `name`, seeding assets/source-images/
 * from public/images/ the first time. Every resize reads from here, so an
 * in-place rewrite never becomes the input to the next run.
 */
async function sourceFor(name) {
    const preserved = path.join(SOURCE_DIR, name);
    if (await exists(preserved)) return preserved;
    const live = path.join(IMAGES_DIR, name);
    if (!(await exists(live))) return null;
    if (!CHECK_ONLY) {
        await mkdir(SOURCE_DIR, { recursive: true });
        await copyFile(live, preserved);
        console.log(`  preserved pristine source -> assets/source-images/${name}`);
        return preserved;
    }
    return live;
}

function encoder(pipeline, format) {
    if (format === 'avif') return pipeline.avif(AVIF);
    if (format === 'webp') return pipeline.webp(WEBP);
    if (format === 'jpeg') return pipeline.jpeg(JPEG);
    if (format === 'png') return pipeline.png({ compressionLevel: 9 });
    throw new Error(`unknown format ${format}`);
}

async function emit(buf, outPath, format) {
    if (CHECK_ONLY) return null;
    const out = await encoder(sharp(buf), format).toBuffer();
    await writeFile(outPath, out);
    return out.length;
}

async function runInPlace() {
    console.log('='.repeat(64));
    console.log('IN-PLACE (same path — external references depend on it)');
    console.log('='.repeat(64));
    for (const item of IN_PLACE) {
        const srcPath = await sourceFor(item.src);
        if (!srcPath) { console.log(`\n${item.src}  NOT FOUND — skipped`); continue; }
        const livePath = path.join(IMAGES_DIR, item.src);
        const pristine = await readFile(srcPath);
        const meta = await sharp(pristine).metadata();
        const liveBefore = (await exists(livePath)) ? (await readFile(livePath)).length : 0;

        console.log(`\n${item.src}  source ${meta.width}x${meta.height}  live ${kb(liveBefore)}`);
        console.log(`  ${item.why}`);

        const format = meta.format === 'png' ? 'png' : 'jpeg';
        let pipeline = sharp(pristine).resize({ width: item.width, withoutEnlargement: true });
        pipeline = format === 'jpeg' && item.quality
            ? pipeline.jpeg({ quality: item.quality, mozjpeg: true })
            : encoder(pipeline, format);
        const out = await pipeline.toBuffer();

        if (out.length >= liveBefore && liveBefore > 0) {
            console.log(`  = already optimized (${kb(liveBefore)} <= ${kb(out.length)}) — left untouched`);
            continue;
        }
        if (!CHECK_ONLY) {
            await writeFile(livePath, out);
            console.log(`  = ${item.src.padEnd(34)} ${kb(out.length)}  (was ${kb(liveBefore)})`);
        } else {
            console.log(`  ~ would write ${kb(out.length)} (was ${kb(liveBefore)})`);
        }
    }
}

async function runDerivatives() {
    console.log('\n' + '='.repeat(64));
    console.log('RESPONSIVE DERIVATIVES');
    console.log('='.repeat(64));
    let derivedTotal = 0;
    const missing = [];

    for (const item of MANIFEST) {
        const srcPath = await sourceFor(item.src);
        if (!srcPath) { missing.push(item.src); continue; }
        const buf = await readFile(srcPath);
        const meta = await sharp(buf).metadata();
        const base = item.src.replace(/\.(jpe?g|png)$/i, '');

        console.log(`\n${item.src}  ${meta.width}x${meta.height}  ${kb(buf.length)}`);
        console.log(`  ${item.note}`);

        for (const entry of item.widths) {
            // A tier is either a bare width (both modern formats) or
            // `{ w, formats }` to restrict which formats that tier emits.
            const width = typeof entry === 'number' ? entry : entry.w;
            const formats = typeof entry === 'number' ? ['avif', 'webp'] : entry.formats;

            // Emit every requested tier even when the source is smaller, so
            // the consuming CSS/JSX can reference one consistent set of names.
            // `withoutEnlargement` means a 640px source simply stays 640px —
            // the width in the filename is a tier label, not a pixel promise.
            if (width > meta.width) {
                console.log(`  ! ${width}w  source is only ${meta.width}px — emitting at native width`);
            }
            const resized = await sharp(buf).resize({ width, withoutEnlargement: true }).toBuffer();

            for (const format of formats) {
                const outName = `${base}-${width}.${format}`;
                const bytes = await emit(resized, path.join(IMAGES_DIR, outName), format);
                if (bytes !== null) {
                    derivedTotal += bytes;
                    console.log(`  + ${outName.padEnd(38)} ${kb(bytes)}`);
                }
            }
        }

        // Single resized same-format fallback for browsers without AVIF/WebP,
        // so they get a right-sized file rather than the original.
        if (item.fallbackWidth) {
            const fmt = item.fallbackFormat || (/\.png$/i.test(item.src) ? 'png' : 'jpeg');
            const ext = fmt === 'jpeg' ? 'jpg' : fmt;
            const resized = await sharp(buf)
                .resize({ width: item.fallbackWidth, withoutEnlargement: true })
                .toBuffer();
            const outName = `${base}-${item.fallbackWidth}.${ext}`;
            const bytes = await emit(resized, path.join(IMAGES_DIR, outName), fmt);
            if (bytes !== null) {
                derivedTotal += bytes;
                console.log(`  + ${outName.padEnd(38)} ${kb(bytes)}  (fallback)`);
            }
        }
    }

    if (missing.length) {
        console.log(`\nWARNING: manifest entries not found: ${missing.join(', ')}`);
    }
    if (!CHECK_ONLY) console.log(`\nderivatives written: ${kb(derivedTotal)}`);
}

async function main() {
    await runInPlace();
    await runDerivatives();

    const live = await readdir(IMAGES_DIR);
    let total = 0;
    for (const f of live) total += (await readFile(path.join(IMAGES_DIR, f))).length;
    console.log('\n' + '-'.repeat(64));
    console.log(`public/images now: ${kb(total)} across ${live.length} files`);
    console.log(CHECK_ONLY ? 'check only — nothing written' : 'done');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
