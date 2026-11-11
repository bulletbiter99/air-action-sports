// Guard: the site is served ONLY at https://airactionsport.com.
//
// Until 2026-11 the same Worker also answered at
// air-action-sports.bulletbiter99.workers.dev, and every PR build published two
// more copies (<version-id>-air-action-sports… and <branch>-air-action-sports…).
// Those hosts sit outside the airactionsport.com zone, so its bot management
// never applied there: GPTBot and ClaudeBot got 403 on the real domain and 200
// on every workers.dev copy, which made the operator's ai-train=no choice
// optional for any crawler that found the other hostname. The fix is two
// top-level keys in wrangler.toml.
//
// What this pins, and why each one fails silently if it regresses:
//   1. workers_dev = false and preview_urls = false at the TOP LEVEL. TOML
//      assigns a key to the nearest [table] above it, so the same line placed
//      below [vars] turns into an environment variable named "workers_dev" and
//      leaves the hosts switched ON — the deploy still succeeds. preview_urls
//      must be explicit: when it is omitted, Wrangler keeps the existing
//      "enabled" setting.
//   2. SITE_URL is the real domain. Email links, Stripe success/cancel URLs and
//      canonical/OG tags are all built from it, and rewriteEventOg (Critical
//      do-not-touch) falls back to the workers.dev host only when it is unset.
//   3. No code points at the dead workers.dev host. The one allowed occurrence
//      is that rewriteEventOg fallback, pinned to exactly one line, so a new
//      reference cannot hide behind the allowlist.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const WRANGLER = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
const DEAD_HOST = 'bulletbiter99.workers.dev';

// TOML with comments removed. None of the values in this file contain '#'.
const lines = WRANGLER.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
const firstTable = lines.findIndex((l) => l.startsWith('['));
const topLevel = lines.slice(0, firstTable === -1 ? lines.length : firstTable);

function tableBody(header) {
    const start = lines.indexOf(header);
    if (start === -1) return [];
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => l.startsWith('['));
    return end === -1 ? rest : rest.slice(0, end);
}

function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (/\.(js|jsx|mjs|cjs|json|html|toml|txt|xml)$/.test(name)) out.push(full);
    }
    return out;
}

describe('wrangler.toml — production is served only on the custom domain', () => {
    it('turns the workers.dev host off with a top-level key', () => {
        expect(topLevel).toContain('workers_dev = false');
    });

    it('turns version and branch preview URLs off with a top-level key', () => {
        expect(topLevel).toContain('preview_urls = false');
    });

    it('never switches either host back on anywhere in the file', () => {
        expect(lines.filter((l) => /^(workers_dev|preview_urls)\s*=\s*true$/.test(l))).toEqual([]);
    });

    it('keeps SITE_URL on the real domain', () => {
        expect(tableBody('[vars]')).toContain('SITE_URL = "https://airactionsport.com"');
    });
});

describe('no code points at the turned-off workers.dev host', () => {
    // Shipped or developer-facing code only. Docs and historical audit
    // reports may still describe the old host.
    const files = [
        ...walk(join(ROOT, 'src')),
        ...walk(join(ROOT, 'worker')),
        ...walk(join(ROOT, 'scripts')),
        ...walk(join(ROOT, 'public')),
        join(ROOT, 'index.html'),
        join(ROOT, 'vite.config.js'),
        join(ROOT, 'wrangler.toml'),
    ];

    const hits = [];
    for (const file of files) {
        readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
            if (line.includes(DEAD_HOST) && !line.trim().startsWith('#')) {
                hits.push({ file: relative(ROOT, file).replace(/\\/g, '/'), line: i + 1, text: line.trim() });
            }
        });
    }

    it('scans a real file set', () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it('allows only the rewriteEventOg SITE_URL fallback (Critical do-not-touch)', () => {
        const allowed = hits.filter(
            (h) => h.file === 'worker/index.js' && h.text.includes('env.SITE_URL ||'),
        );
        expect(allowed).toHaveLength(1);
        expect(hits.filter((h) => !allowed.includes(h))).toEqual([]);
    });
});
