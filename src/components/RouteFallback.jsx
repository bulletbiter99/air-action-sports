/**
 * Shown while a lazy route chunk is in flight.
 *
 * App.jsx previously passed `fallback={null}`, which renders nothing at all —
 * so on a slow connection every navigation showed the bare dark page background
 * until the chunk arrived, which reads as "the page just went black".
 *
 * Deliberately minimal: a centred pulse on the normal page background, sized to
 * roughly the height of a page header so the layout does not jump when the real
 * content swaps in.
 */
export default function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6rem 2rem',
      }}
    >
      <div
        style={{
          width: 48,
          height: 3,
          background: 'var(--orange, #d2601a)',
          animation: 'aas-route-pulse 1s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes aas-route-pulse {
          0%, 100% { opacity: 0.25; transform: scaleX(0.6); }
          50%      { opacity: 1;    transform: scaleX(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="status"] > div { animation: none !important; opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
