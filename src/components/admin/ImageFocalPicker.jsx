import { useRef, useState, useCallback } from 'react';
import './ImageFocalPicker.css';

function clamp(n) {
  return Math.max(0, Math.min(100, n));
}

const KEYWORDS = { left: 0, right: 100, top: 0, bottom: 100, center: 50 };

// Parse a CSS background-position string into { x, y } percentages (0-100).
// Accepts "x% y%", single keywords (top/bottom/left/right/center), or empty.
export function parsePosition(value) {
  if (!value || typeof value !== 'string') return { x: 50, y: 50 };
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'center') return { x: 50, y: 50 };
  const parts = v.split(/\s+/);
  const toPct = (p, fallback) => {
    if (p == null) return fallback;
    if (p in KEYWORDS) return KEYWORDS[p];
    const m = /^(-?\d+(?:\.\d+)?)%$/.exec(p);
    return m ? clamp(parseFloat(m[1])) : fallback;
  };
  if (parts.length === 1) {
    const p = parts[0];
    if (p === 'top' || p === 'bottom') return { x: 50, y: KEYWORDS[p] };
    if (p === 'left' || p === 'right') return { x: KEYWORDS[p], y: 50 };
    return { x: toPct(p, 50), y: 50 };
  }
  return { x: toPct(parts[0], 50), y: toPct(parts[1], 50) };
}

// Format { x, y } percentages into a CSS background-position string.
// 50/50 collapses to the keyword "center" (so untouched images stay default).
export function formatPosition({ x, y }) {
  const xi = Math.round(clamp(x));
  const yi = Math.round(clamp(y));
  return xi === 50 && yi === 50 ? 'center' : `${xi}% ${yi}%`;
}

/**
 * ImageFocalPicker — pick the focal point of an image so it stays visible when
 * the image is rendered with `background-size: cover`. Controlled component:
 * pass `value` (a CSS background-position string) and `onChange(nextValue)`.
 * Reused by the event image picker and the admin site editor.
 */
export default function ImageFocalPicker({
  image,
  value,
  onChange,
  label = 'Image focal point',
  hint = 'Click or drag the marker onto the most important part of the image — it stays visible when the image is cropped.',
  disabled = false,
  previewAspect = '2 / 1',
}) {
  const stageRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const { x, y } = parsePosition(value);

  const emitFromPoint = useCallback(
    (clientX, clientY) => {
      const el = stageRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const nx = clamp(((clientX - r.left) / r.width) * 100);
      const ny = clamp(((clientY - r.top) / r.height) * 100);
      onChange?.(formatPosition({ x: nx, y: ny }));
    },
    [onChange],
  );

  const handlePointerDown = (e) => {
    if (disabled || !image) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    emitFromPoint(e.clientX, e.clientY);
  };

  const handlePointerMove = (e) => {
    if (!dragging) return;
    emitFromPoint(e.clientX, e.clientY);
  };

  const handlePointerUp = (e) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const handleKeyDown = (e) => {
    if (disabled || !image) return;
    const step = e.shiftKey ? 10 : 2;
    let nx = x;
    let ny = y;
    switch (e.key) {
      case 'ArrowLeft': nx = clamp(x - step); break;
      case 'ArrowRight': nx = clamp(x + step); break;
      case 'ArrowUp': ny = clamp(y - step); break;
      case 'ArrowDown': ny = clamp(y + step); break;
      case 'Home': nx = 50; ny = 50; break;
      default: return;
    }
    e.preventDefault();
    onChange?.(formatPosition({ x: nx, y: ny }));
  };

  if (!image) {
    return (
      <div className="ifp ifp--empty">
        {label ? <div className="ifp__label">{label}</div> : null}
        <div className="ifp__placeholder">Upload an image to set its focal point.</div>
      </div>
    );
  }

  const position = formatPosition({ x, y });

  return (
    <div className={`ifp${disabled ? ' ifp--disabled' : ''}`}>
      {label ? <div className="ifp__label">{label}</div> : null}
      <div className="ifp__row">
        <div
          ref={stageRef}
          className={`ifp__stage${dragging ? ' is-dragging' : ''}`}
          role="slider"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(x)}
          aria-valuetext={`Horizontal ${Math.round(x)}%, vertical ${Math.round(y)}%`}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
        >
          <img className="ifp__img" src={image} alt="" draggable={false} />
          <span className="ifp__marker" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true" />
        </div>
        <div className="ifp__preview-wrap">
          <div className="ifp__preview-label">Cropped preview</div>
          <div
            className="ifp__preview"
            style={{ backgroundImage: `url("${image}")`, backgroundPosition: position, aspectRatio: previewAspect }}
          />
        </div>
      </div>
      <div className="ifp__footer">
        <span className="ifp__value" data-testid="ifp-value">{position}</span>
        <button type="button" className="ifp__reset" disabled={disabled} onClick={() => onChange?.('center')}>
          Reset to center
        </button>
      </div>
      {hint ? <div className="ifp__hint">{hint}</div> : null}
    </div>
  );
}
