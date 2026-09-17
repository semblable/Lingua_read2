import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Sparkline from '../Sparkline';

const point = (date: string, count: number) => ({ date, count });

const paths = (container: HTMLElement): SVGPathElement[] =>
  Array.from(container.querySelectorAll('path'));

// Every y in a path's "d", so tests can assert on the drawn shape.
const yValues = (d: string): number[] =>
  (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter((_, i) => i % 2 === 1);

afterEach(cleanup);

describe('Sparkline', () => {
  test('draws a fill and a stroke path with an accessible label', () => {
    const { container } = render(
      <Sparkline
        data={[point('2026-09-01', 0), point('2026-09-02', 40), point('2026-09-03', 10)]}
        ariaLabel="Polish: words read over the last 14 days"
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Polish: words read over the last 14 days',
    );
    const [fill, stroke] = paths(container);
    expect(fill).toHaveAttribute('fill', expect.stringContaining('url(#'));
    expect(stroke).toHaveAttribute('stroke', '#3498DB');
    expect(stroke).toHaveAttribute('fill', 'none');
    // The fill closes back down to the baseline; the line doesn't.
    expect(fill.getAttribute('d')).toMatch(/Z$/);
    expect(stroke.getAttribute('d')).not.toMatch(/Z$/);
  });

  test('scales against the highest count and keeps the curve inside the box', () => {
    const { container } = render(
      <Sparkline
        data={[point('2026-09-01', 0), point('2026-09-02', 5), point('2026-09-03', 100)]}
        height={48}
        topPadding={4}
      />,
    );
    const ys = yValues(paths(container)[1].getAttribute('d') || '');
    // y grows downwards: the zero point sits on the baseline, the peak at topPadding.
    expect(Math.max(...ys)).toBe(48);
    expect(Math.min(...ys)).toBe(4);
    // Monotone interpolation must not overshoot past the baseline or the top.
    expect(ys.every((y) => y >= 4 && y <= 48)).toBe(true);
  });

  test('draws a flat baseline when every count is zero', () => {
    const { container } = render(
      <Sparkline data={[point('2026-09-01', 0), point('2026-09-02', 0)]} height={48} />,
    );
    const ys = yValues(paths(container)[1].getAttribute('d') || '');
    expect(ys.every((y) => y === 48)).toBe(true);
  });

  test('renders nothing without data', () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  test('gives each instance its own gradient id', () => {
    const { container } = render(
      <>
        <Sparkline data={[point('2026-09-01', 1), point('2026-09-02', 2)]} />
        <Sparkline data={[point('2026-09-01', 3), point('2026-09-02', 4)]} />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('linearGradient')).map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
