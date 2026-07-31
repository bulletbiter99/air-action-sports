// @vitest-environment jsdom
//
// Pins the recovery path for a failed lazy-route chunk.
//
// Every route in App.jsx is React.lazy, the site redeploys on every merge (which
// re-hashes chunk filenames), and the worker serves the SPA shell at HTTP 200
// for any unmatched path — so a visitor whose tab spans a deploy requests a
// chunk that no longer exists, gets HTML back, and the import rejects with a
// SyntaxError. With no boundary React unmounted the whole tree and the page went
// black until a manual refresh.
//
// Both directions matter here. A test that only asserted "reloads on a chunk
// error" would pass with the cooldown guard deleted — and that guard is the only
// thing standing between a bad deploy and an infinite reload loop.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../helpers/renderComponent.jsx';
import ChunkErrorBoundary, {
  isChunkLoadError,
} from '../../../src/components/ChunkErrorBoundary.jsx';

const RELOAD_STAMP_KEY = 'aas:chunk-reload-at';

// Real browser messages, one per engine, plus the shape THIS site actually
// produces (HTML parsed as an ES module).
const CHUNK_ERRORS = {
  chrome: 'Failed to fetch dynamically imported module: https://x/assets/About-a1.js',
  firefox: 'error loading dynamically imported module',
  safari: 'Importing a module script failed.',
  htmlAsJs: "Unexpected token '<'",
};

function Boom({ error }) {
  throw error;
}

/** Renders the boundary around a component that throws immediately. */
function renderThrowing(error) {
  return renderWithRouter(
    <ChunkErrorBoundary>
      <Boom error={error} />
    </ChunkErrorBoundary>
  );
}

let reloadSpy;

beforeEach(() => {
  window.sessionStorage.clear();

  reloadSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...window.location, reload: reloadSpy },
  });

  // React logs caught boundary errors; keep the suite output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('isChunkLoadError', () => {
  for (const [engine, message] of Object.entries(CHUNK_ERRORS)) {
    it(`recognises the ${engine} failure`, () => {
      expect(isChunkLoadError(new Error(message))).toBe(true);
    });
  }

  it('recognises a ChunkLoadError by name even with an empty message', () => {
    const err = new Error('');
    err.name = 'ChunkLoadError';
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('does NOT claim an unrelated application error', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(new TypeError('x.map is not a function'))).toBe(false);
  });

  it('does not throw on null/undefined', () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('ChunkErrorBoundary', () => {
  it('renders children untouched when nothing throws', () => {
    renderWithRouter(
      <ChunkErrorBoundary>
        <p>live content</p>
      </ChunkErrorBoundary>
    );
    expect(screen.getByText('live content')).toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('reloads once on a stale-chunk error and stamps sessionStorage', () => {
    renderThrowing(new Error(CHUNK_ERRORS.chrome));

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(Number(window.sessionStorage.getItem(RELOAD_STAMP_KEY))).toBeGreaterThan(0);
  });

  it('does NOT reload again when a reload was just attempted — the loop guard', () => {
    // A reload moments ago means reloading did not fix it; looping would trap
    // the visitor in a refresh cycle.
    window.sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));

    renderThrowing(new Error(CHUNK_ERRORS.chrome));

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/needs a refresh/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
  });

  it('reloads again once the cooldown has elapsed (a later, unrelated deploy)', () => {
    window.sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now() - 60_000));

    renderThrowing(new Error(CHUNK_ERRORS.chrome));

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('never auto-reloads a genuine application error', () => {
    // Reloading an app bug just replays it; the visitor should see a message.
    renderThrowing(new TypeError('events.map is not a function'));

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('shows a recovery card rather than a blank page — the actual bug', () => {
    window.sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));

    const { container } = renderThrowing(new Error(CHUNK_ERRORS.htmlAsJs));

    // The pre-fix behaviour was an empty tree. Anything rendered beats that,
    // but specifically the visitor must get a way out.
    expect(container.textContent.trim().length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
  });

  it('survives sessionStorage being unavailable (private mode)', () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });

    // Must not crash, and with no way to stamp it must not reload either —
    // an unstampable reload is exactly how you build an infinite loop.
    expect(() => renderThrowing(new Error(CHUNK_ERRORS.chrome))).not.toThrow();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
