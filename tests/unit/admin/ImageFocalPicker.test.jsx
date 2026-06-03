// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../helpers/renderComponent.jsx';
import ImageFocalPicker, {
  parsePosition,
  formatPosition,
} from '../../../src/components/admin/ImageFocalPicker.jsx';

// jsdom lacks PointerEvent; minimal polyfill so fireEvent.pointer* works.
if (typeof window !== 'undefined' && !window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type, props = {}) {
      super(type, props);
      this.pointerId = props.pointerId;
    }
  }
  window.PointerEvent = PointerEventPolyfill;
}

function sizedRect(el, width, height) {
  el.getBoundingClientRect = () => ({
    left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON() {},
  });
}

describe('parsePosition', () => {
  it('defaults empty / null / "center" to 50/50', () => {
    expect(parsePosition(undefined)).toEqual({ x: 50, y: 50 });
    expect(parsePosition('')).toEqual({ x: 50, y: 50 });
    expect(parsePosition('center')).toEqual({ x: 50, y: 50 });
  });
  it('parses an "x% y%" pair', () => {
    expect(parsePosition('20% 80%')).toEqual({ x: 20, y: 80 });
  });
  it('maps single keywords to the right axis', () => {
    expect(parsePosition('top')).toEqual({ x: 50, y: 0 });
    expect(parsePosition('bottom')).toEqual({ x: 50, y: 100 });
    expect(parsePosition('left')).toEqual({ x: 0, y: 50 });
    expect(parsePosition('right')).toEqual({ x: 100, y: 50 });
  });
  it('clamps out-of-range percentages', () => {
    expect(parsePosition('150% -10%')).toEqual({ x: 100, y: 0 });
  });
});

describe('formatPosition', () => {
  it('collapses 50/50 to "center"', () => {
    expect(formatPosition({ x: 50, y: 50 })).toBe('center');
  });
  it('rounds to an integer "x% y%"', () => {
    expect(formatPosition({ x: 19.6, y: 80.2 })).toBe('20% 80%');
  });
  it('clamps before formatting', () => {
    expect(formatPosition({ x: -5, y: 130 })).toBe('0% 100%');
  });
});

describe('ImageFocalPicker', () => {
  it('shows a placeholder when there is no image', () => {
    render(<ImageFocalPicker value="center" onChange={() => {}} />);
    expect(screen.getByText(/upload an image/i)).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('renders the current position value', () => {
    render(<ImageFocalPicker image="/x.jpg" value="20% 80%" onChange={() => {}} />);
    expect(screen.getByTestId('ifp-value')).toHaveTextContent('20% 80%');
  });

  it('emits the clicked point as a position', () => {
    const onChange = vi.fn();
    render(<ImageFocalPicker image="/x.jpg" value="center" onChange={onChange} />);
    const stage = screen.getByRole('slider');
    sizedRect(stage, 200, 100);
    fireEvent.pointerDown(stage, { clientX: 50, clientY: 25, pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith('25% 25%');
  });

  it('clamps a click outside the stage bounds', () => {
    const onChange = vi.fn();
    render(<ImageFocalPicker image="/x.jpg" value="center" onChange={onChange} />);
    const stage = screen.getByRole('slider');
    sizedRect(stage, 200, 100);
    fireEvent.pointerDown(stage, { clientX: 400, clientY: -40, pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith('100% 0%');
  });

  it('nudges with arrow keys (2% default)', () => {
    const onChange = vi.fn();
    render(<ImageFocalPicker image="/x.jpg" value="center" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('52% 50%');
  });

  it('nudges 10% with Shift held', () => {
    const onChange = vi.fn();
    render(<ImageFocalPicker image="/x.jpg" value="center" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowDown', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith('50% 60%');
  });

  it('resets to center', () => {
    const onChange = vi.fn();
    render(<ImageFocalPicker image="/x.jpg" value="20% 80%" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /reset to center/i }));
    expect(onChange).toHaveBeenCalledWith('center');
  });

  it('does not emit when disabled', () => {
    const onChange = vi.fn();
    render(<ImageFocalPicker image="/x.jpg" value="center" onChange={onChange} disabled />);
    const stage = screen.getByRole('slider');
    sizedRect(stage, 200, 100);
    fireEvent.pointerDown(stage, { clientX: 50, clientY: 25, pointerId: 1 });
    fireEvent.keyDown(stage, { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
