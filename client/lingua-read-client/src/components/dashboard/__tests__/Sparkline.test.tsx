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

  test('scales against the highest count', () => {
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
  });

  // The curve must stay inside the box for ANY series, not just gentle ones: it is clipped
  // by the viewBox, so an overshoot renders as a flattened peak or a line under the zero
  // baseline. Asserting it on one hand-picked series proves nothing — almost any
  // interpolation passes that — so sweep a deterministic spread of shapes and sample the
  // actual Bezier, not just its control points.
  describe('stays inside the drawing box', () => {
    const H = 48;
    const TOP = 4;

    // Sample every cubic segment of a path built by Sparkline.
    const curveExtent = (d: string): { lo: number; hi: number } => {
      const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      let lo = Infinity;
      let hi = -Infinity;
      // "M x y" then repeating "C x1 y1 x2 y2 x y": 2 + 6k numbers.
      let cursor = { x: nums[0], y: nums[1] };
      for (let i = 2; i + 5 < nums.length; i += 6) {
        const [p0, p1, p2, p3] = [cursor.y, nums[i + 1], nums[i + 3], nums[i + 5]];
        for (let t = 0; t <= 1; t += 0.01) {
          const u = 1 - t;
          const y = u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
        cursor = { x: nums[i + 4], y: nums[i + 5] };
      }
      return { lo, hi };
    };

    const check = (counts: number[]): { lo: number; hi: number } => {
      const { container } = render(
        <Sparkline
          data={counts.map((c, i) => point(`2026-09-${String(i + 1).padStart(2, '0')}`, c))}
          height={H}
          topPadding={TOP}
        />,
      );
      const extent = curveExtent(paths(container)[1].getAttribute('d') || '');
      cleanup();
      return extent;
    };

    // Series that overshot before the negative-tangent clamp was added.
    test.each([
      ['peak next to a zero day', [708, 0, 985, 844, 951, 528, 596, 684, 138, 395, 650, 569, 0, 892]],
      ['alternating zero and peak', [0, 900, 0, 880, 0, 910, 0, 870, 0, 890, 0, 900, 0, 880]],
      ['single dip to zero', [500, 520, 480, 0, 500, 510, 490, 505, 500, 495, 500, 510, 505, 500]],
      ['steep then flat', [1000, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]],
    ])('%s', (_label, counts) => {
      const { lo, hi } = check(counts);
      expect(lo).toBeGreaterThanOrEqual(TOP - 0.01);
      expect(hi).toBeLessThanOrEqual(H + 0.01);
    });

    test('holds across 200 generated series', () => {
      // Deterministic LCG, so a failure is reproducible from the seed.
      let seed = 1337;
      const next = (): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      for (let trial = 0; trial < 200; trial += 1) {
        const counts = Array.from({ length: 14 }, () =>
          next() < 0.3 ? 0 : Math.floor(next() * 1000),
        );
        if (Math.max(...counts) === 0) continue;
        const { lo, hi } = check(counts);
        expect({ counts, lo: lo >= TOP - 0.01, hi: hi <= H + 0.01 }).toEqual({
          counts,
          lo: true,
          hi: true,
        });
      }
    });
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
