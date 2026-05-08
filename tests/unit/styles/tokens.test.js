// M5 Batch 0 (sub-batch 0-tokens) — sanity assertions for the design-token
// surface in src/styles/tokens.css. CSS-string regex checks; no DOM. The
// goal is to catch accidental token deletions or shape regressions in
// future refactors. The token VALUES are not asserted (they may evolve);
// the token NAMES and the structural invariants are.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const tokensPath = path.resolve(process.cwd(), 'src/styles/tokens.css');
const css = fs.readFileSync(tokensPath, 'utf8');

function tokenLine(name) {
  // Matches "  --name: value;" anywhere in the file. Returns the captured
  // value or undefined.
  const re = new RegExp(`--${name}\\s*:\\s*([^;]+);`);
  const m = css.match(re);
  return m ? m[1].trim() : undefined;
}

describe('tokens.css — density (M2 B5c, preserved)', () => {
  it('exposes the four density vars', () => {
    expect(tokenLine('admin-pad-main')).toBeDefined();
    expect(tokenLine('admin-pad-nav')).toBeDefined();
    expect(tokenLine('admin-pad-section-label')).toBeDefined();
    expect(tokenLine('admin-row-gap')).toBeDefined();
  });

  it('preserves the compact-density override block', () => {
    expect(css).toMatch(/\[data-density="compact"\]\s*\{/);
    // The compact block must redeclare all four density vars
    const compactBlockMatch = css.match(/\[data-density="compact"\]\s*\{([\s\S]*?)\}/);
    expect(compactBlockMatch).toBeTruthy();
    const compactBody = compactBlockMatch[1];
    expect(compactBody).toMatch(/--admin-pad-main\s*:/);
    expect(compactBody).toMatch(/--admin-pad-nav\s*:/);
    expect(compactBody).toMatch(/--admin-pad-section-label\s*:/);
    expect(compactBody).toMatch(/--admin-row-gap\s*:/);
  });
});

describe('tokens.css — spacing scale (M5 B0)', () => {
  it.each(['space-4', 'space-8', 'space-12', 'space-16', 'space-24', 'space-32', 'space-48'])(
    'defines --%s',
    (name) => {
      expect(tokenLine(name)).toBeDefined();
    },
  );

  it('uses px units for the scale (not rem) so values match raw inline literals being replaced', () => {
    for (const n of [4, 8, 12, 16, 24, 32, 48]) {
      const v = tokenLine(`space-${n}`);
      expect(v).toMatch(/^\d+px$/);
    }
  });
});

describe('tokens.css — typography scale (M5 B0)', () => {
  it.each(['font-size-xs', 'font-size-sm', 'font-size-base', 'font-size-md', 'font-size-lg', 'font-size-xl', 'font-size-2xl', 'font-size-3xl'])(
    'defines --%s',
    (name) => {
      expect(tokenLine(name)).toBeDefined();
    },
  );

  it.each(['font-weight-normal', 'font-weight-medium', 'font-weight-semibold', 'font-weight-bold', 'font-weight-extrabold'])(
    'defines --%s',
    (name) => {
      expect(tokenLine(name)).toBeDefined();
    },
  );

  it.each(['line-height-tight', 'line-height-normal', 'line-height-relaxed'])(
    'defines --%s',
    (name) => {
      expect(tokenLine(name)).toBeDefined();
    },
  );

  it.each(['letter-spacing-tight', 'letter-spacing-wide', 'letter-spacing-wider', 'letter-spacing-widest'])(
    'defines --%s',
    (name) => {
      expect(tokenLine(name)).toBeDefined();
    },
  );
});

describe('tokens.css — radius scale (M5 B0)', () => {
  it.each(['radius-none', 'radius-sm', 'radius-md', 'radius-lg', 'radius-xl', 'radius-pill', 'radius-circle'])(
    'defines --%s',
    (name) => {
      expect(tokenLine(name)).toBeDefined();
    },
  );
});

describe('tokens.css — semantic color aliases (M5 B0)', () => {
  it.each([
    'color-bg-page',
    'color-bg-elevated',
    'color-bg-sunken',
    'color-bg-hover',
    'color-bg-selected',
    'color-text',
    'color-text-muted',
    'color-text-subtle',
    'color-text-inverse',
    'color-accent',
    'color-accent-dark',
    'color-accent-soft',
    'color-accent-on-accent',
    'color-border',
    'color-border-strong',
    'color-border-subtle',
    'color-overlay',
    'color-overlay-strong',
    'color-shadow-soft',
    'color-shadow-medium',
    'color-shadow-hard',
  ])('defines --%s', (name) => {
    expect(tokenLine(name)).toBeDefined();
  });

  it('aliases bg/text/accent to brand vars from global.css (not duplicate hex literals)', () => {
    expect(tokenLine('color-bg-page')).toBe('var(--dark)');
    expect(tokenLine('color-bg-elevated')).toBe('var(--mid)');
    expect(tokenLine('color-text')).toBe('var(--cream)');
    expect(tokenLine('color-text-muted')).toBe('var(--tan-light)');
    expect(tokenLine('color-text-subtle')).toBe('var(--olive-light)');
    expect(tokenLine('color-accent')).toBe('var(--orange)');
    expect(tokenLine('color-accent-dark')).toBe('var(--orange-dark)');
  });
});

describe('tokens.css — status colors (M5 B0)', () => {
  it.each([
    'color-success',
    'color-success-soft',
    'color-warning',
    'color-warning-soft',
    'color-danger',
    'color-danger-soft',
    'color-info',
    'color-info-soft',
  ])('defines --%s', (name) => {
    expect(tokenLine(name)).toBeDefined();
  });
});

describe('tokens.css — shadows + motion (M5 B0)', () => {
  it.each(['shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl'])(
    'defines --%s',
    (name) => {
      expect(tokenLine(name)).toBeDefined();
    },
  );

  it.each(['duration-fast', 'duration-base', 'duration-slow', 'easing-standard', 'easing-emphasized'])(
    'defines --%s',
    (name) => {
      expect(tokenLine(name)).toBeDefined();
    },
  );

  it('honors prefers-reduced-motion for duration tokens', () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/);
    const prmBlock = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(prmBlock).toBeTruthy();
    expect(prmBlock[1]).toMatch(/--duration-fast\s*:\s*0ms/);
    expect(prmBlock[1]).toMatch(/--duration-base\s*:\s*0ms/);
    expect(prmBlock[1]).toMatch(/--duration-slow\s*:\s*0ms/);
  });
});

describe('tokens.css — invariants (M5 B0)', () => {
  it('keeps :root + [data-density="compact"] as the only top-level rules besides @media prefers-reduced-motion', () => {
    // No selectors like `.foo` or `body` should sneak in here — this file is
    // pure tokens. Strip /* … */ comment blocks before checking so prose
    // inside header comments doesn't trip the test.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const lines = stripped.split('\n');
    // A "selector line" ends with `{` after the trim — that's the actual
    // CSS rule opener, not a property line.
    const selectorLines = lines
      .map((l) => l.trim())
      .filter((l) => l.endsWith('{'));
    for (const trimmed of selectorLines) {
      const ok =
        trimmed.startsWith(':root') ||
        trimmed.startsWith('[data-density') ||
        trimmed.startsWith('@media');
      expect(ok, `unexpected selector at top level: "${trimmed}"`).toBe(true);
    }
  });

  it('does not redeclare any brand-color hex literal — they live in global.css', () => {
    // The hex values from global.css :root must NOT be duplicated here.
    // Aliases via var() are fine; literal hex of brand colors is not.
    const brandHexes = ['#4a5240', '#2c3127', '#6b7560', '#c8b89a', '#e8dcc8', '#d4541a', '#a83e12', '#f2ede4', '#1a1c18', '#2e3229'];
    for (const hex of brandHexes) {
      expect(css.toLowerCase().includes(hex.toLowerCase())).toBe(false);
    }
  });
});
