import React, { useId } from 'react';

// A 48px activity sparkline, drawn as plain SVG.
//
// This used to be a recharts <AreaChart>. The home page renders one card per
// language and is NOT lazy-loaded, so recharts (108 kB gzipped, its own vendor
// chunk) was pulled into the first page load for a decorative 14-point line.
// The curve below is the same shape recharts drew: monotone cubic interpolation
// (Fritsch-Carlson), a 1.5px stroke, and the same top-down gradient fill.
// The Statistics page still uses recharts — it's behind a lazy route.

export interface SparklinePoint {
  date: string;
  count: number;
}

interface SparklineProps {
  data: SparklinePoint[];
  /** Drawing height in viewBox units; the SVG itself always fills its parent. */
  height?: number;
  color?: string;
  /** Empty space above the peak, so a full-height point isn't clipped by the stroke. */
  topPadding?: number;
  ariaLabel?: string;
}

// Tangents for monotone cubic interpolation: averaged secant slopes, clamped so
// the curve can't overshoot a data point (which would dip a count below zero).
const monotoneTangents = (ys: number[], dx: number): number[] => {
  const n = ys.length;
  const secants = Array.from({ length: n - 1 }, (_, i) => (ys[i + 1] - ys[i]) / dx);
  const m = Array.from({ length: n }, (_, i) => {
    if (i === 0) return secants[0];
    if (i === n - 1) return secants[n - 2];
    return (secants[i - 1] + secants[i]) / 2;
  });
  for (let i = 0; i < n - 1; i += 1) {
    if (secants[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const alpha = m[i] / secants[i];
    const beta = m[i + 1] / secants[i];
    const sum = alpha * alpha + beta * beta;
    if (sum > 9) {
      const tau = 3 / Math.sqrt(sum);
      m[i] = tau * alpha * secants[i];
      m[i + 1] = tau * beta * secants[i];
    }
  }
  return m;
};

const round = (n: number): number => Math.round(n * 100) / 100;

const Sparkline = ({
  data,
  height = 48,
  color = '#3498DB',
  topPadding = 4,
  ariaLabel = 'Reading activity over the last 14 days',
}: SparklineProps) => {
  const gradientId = useId();

  if (!data || data.length === 0) return null;

  const width = 100; // viewBox units; preserveAspectRatio="none" stretches to the parent
  const counts = data.map((d) => d.count);
  // Same as recharts' YAxis domain={[0, 'dataMax']}: the baseline is always zero.
  const max = Math.max(...counts, 0);
  const usable = height - topPadding;
  const toY = (count: number): number => (max <= 0 ? height : height - (count / max) * usable);

  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const xs = data.map((_, i) => i * step);
  const ys = counts.map(toY);

  let line: string;
  if (data.length === 1) {
    // One point has no curve; draw a flat line so the fill is still visible.
    line = `M 0 ${round(ys[0])} L ${width} ${round(ys[0])}`;
  } else {
    const m = monotoneTangents(ys, step);
    line = `M ${round(xs[0])} ${round(ys[0])}`;
    for (let i = 0; i < data.length - 1; i += 1) {
      const c1x = xs[i] + step / 3;
      const c1y = ys[i] + (m[i] * step) / 3;
      const c2x = xs[i + 1] - step / 3;
      const c2y = ys[i + 1] - (m[i + 1] * step) / 3;
      line += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(xs[i + 1])} ${round(ys[i + 1])}`;
    }
  }

  const area = `${line} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={color} stopOpacity={0.4} />
          <stop offset="95%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} stroke="none" />
      {/* non-scaling-stroke: preserveAspectRatio="none" would otherwise stretch the line horizontally. */}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

export default Sparkline;
