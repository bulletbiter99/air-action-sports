import { Component } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Recovers from a failed lazy-route chunk load.
 *
 * Every route in App.jsx is React.lazy, so navigating fetches a content-hashed
 * chunk. The site redeploys on every merge, which re-hashes those filenames. A
 * visitor whose tab was open across a deploy still holds the OLD index.html, so
 * clicking through to a page they have not visited yet requests a chunk that no
 * longer exists.
 *
 * The worker serves the SPA shell for any unmatched path, so that request comes
 * back HTTP 200 with `text/html` rather than a 404. The browser then tries to
 * parse `<!DOCTYPE html>` as an ES module and the import rejects with a
 * SyntaxError. Without a boundary React unmounts the whole tree and the page
 * goes blank until a manual refresh — which is exactly why a refresh fixes it.
 *
 * Reloading re-fetches index.html and picks up the current hashes. The
 * sessionStorage stamp makes that a ONE-SHOT: if a reload does not fix it the
 * cause is not a stale chunk, so we show a recovery card instead of looping.
 */

const RELOAD_STAMP_KEY = 'aas:chunk-reload-at';
const RELOAD_COOLDOWN_MS = 10_000;

const CHUNK_ERROR_PATTERNS = [
  // Chrome / Edge
  'failed to fetch dynamically imported module',
  // Firefox
  'error loading dynamically imported module',
  // Safari
  'importing a module script failed',
  // The HTML-served-as-JS case above surfaces as a parse error.
  'unexpected token',
  // Defensive: bundler-flavoured variants.
  'chunkloaderror',
  'loading chunk',
  'failed to import',
];

export function isChunkLoadError(error) {
  if (!error) return false;
  const haystack = `${error.name || ''} ${error.message || ''}`.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((p) => haystack.includes(p));
}

function readReloadStamp() {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_STAMP_KEY)) || 0;
  } catch {
    // Private mode / storage disabled — treat as "never reloaded" but the
    // write below will also no-op, so we degrade to the recovery card.
    return 0;
  }
}

function writeReloadStamp(now) {
  try {
    window.sessionStorage.setItem(RELOAD_STAMP_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

class ChunkErrorBoundaryInner extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    // A new navigation clears a previous failure, so one bad chunk cannot
    // poison every subsequent route.
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error) {
    if (!isChunkLoadError(error)) return;

    const now = Date.now();
    const last = readReloadStamp();
    if (now - last < RELOAD_COOLDOWN_MS) return; // already tried; show the card

    if (writeReloadStamp(now)) {
      window.location.reload();
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isChunkLoadError(error);

    return (
      <div
        role="alert"
        style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6rem 2rem 4rem',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <h1
            style={{
              fontSize: 'clamp(24px, 5vw, 34px)',
              fontWeight: 900,
              textTransform: 'uppercase',
              color: 'var(--cream, #f2ede3)',
              marginBottom: '1rem',
            }}
          >
            {stale ? 'This page needs a refresh' : 'Something went wrong'}
          </h1>
          <p
            style={{
              color: 'var(--olive-light, #b8bda8)',
              lineHeight: 1.7,
              marginBottom: '2rem',
            }}
          >
            {stale
              ? 'The site was updated while you had it open, so this page could not load. Reloading will pick up the latest version.'
              : 'We hit an unexpected error loading this page. Reloading usually clears it.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: 'var(--orange, #d2601a)',
              color: 'white',
              padding: '14px 32px',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 3,
              textTransform: 'uppercase',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

export default function ChunkErrorBoundary({ children }) {
  const location = useLocation();
  return (
    <ChunkErrorBoundaryInner resetKey={location.pathname}>
      {children}
    </ChunkErrorBoundaryInner>
  );
}
