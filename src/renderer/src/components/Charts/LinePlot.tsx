import './LinePlot.css';

export interface PlotPoint {
  x: number;
  y: number;
}
const axisNumber = (value: number) => Number(value.toPrecision(4)).toString();

/** Rendering only: callers own sampling, retention and the meaning of the time axis. */
export default function LinePlot({
  points,
  min,
  max,
  duration,
  label,
  compact = false,
  stepped = false,
}: {
  points: PlotPoint[];
  min: number;
  max: number;
  duration: number;
  label: string;
  compact?: boolean;
  stepped?: boolean;
}) {
  const width = compact ? 100 : 680;
  const height = compact ? 24 : 152;
  const left = compact ? 2 : 72;
  const right = width - (compact ? 2 : 18);
  const top = compact ? 3 : 12;
  const bottom = compact ? 21 : 118;
  const range = max - min;
  const coordinates = points.map(({ x, y }) => ({
    x: left + (x / (duration || 1)) * (right - left),
    y: range === 0 ? (top + bottom) / 2 : bottom - ((y - min) / range) * (bottom - top),
  }));
  const path = coordinates
    .map((point, index) =>
      index === 0
        ? `M${point.x},${point.y}`
        : stepped
          ? `H${point.x}V${point.y}`
          : `L${point.x},${point.y}`,
    )
    .join(' ');
  return (
    <svg
      className={`line-plot${compact ? ' line-plot-compact' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      {!compact && (
        <>
          {[0, 1, 2, 3, 4].map((index) => (
            <g key={index} className="line-plot-axis">
              <line
                x1={left}
                x2={right}
                y1={top + (index * (bottom - top)) / 4}
                y2={top + (index * (bottom - top)) / 4}
              />
              <text x={left - 8} y={top + (index * (bottom - top)) / 4 + 4} textAnchor="end">
                {axisNumber(max - ((max - min) * index) / 4)}
              </text>
            </g>
          ))}
          {[0, 1, 2, 3].map((index) => (
            <g key={index} className="line-plot-axis">
              <line
                x1={left + (index * (right - left)) / 3}
                x2={left + (index * (right - left)) / 3}
                y1={top}
                y2={bottom}
              />
              <text x={left + (index * (right - left)) / 3} y={height - 8} textAnchor="middle">
                {axisNumber((duration * index) / 3000)} s
              </text>
            </g>
          ))}
        </>
      )}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={compact ? 1.5 : 2}
        strokeLinejoin="round"
      />
    </svg>
  );
}
