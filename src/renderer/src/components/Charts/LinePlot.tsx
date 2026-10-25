import './LinePlot.css';

export interface PlotPoint {
  x: number;
  y: number;
  breakBefore?: boolean;
}
const axisNumber = (value: number) => {
  const rounded = Number(value.toPrecision(4));
  return Number.isFinite(rounded) ? rounded.toString() : value.toExponential(3);
};

/** Rendering only: callers own sampling, retention and the meaning of the time axis. */
export default function LinePlot({
  points = [],
  series,
  min,
  max,
  duration,
  label,
  compact = false,
  stepped = false,
  plotHeight = 152,
  formatX,
  onInspect,
}: {
  points?: PlotPoint[];
  /** A series with its own min/max uses an independent scale; shared labels are then hidden. */
  series?: { id: string; color: string; points: PlotPoint[]; min?: number; max?: number }[];
  min: number;
  max: number;
  duration: number;
  label: string;
  compact?: boolean;
  stepped?: boolean;
  plotHeight?: number;
  formatX?: (value: number) => string;
  onInspect?: (fraction: number) => void;
}) {
  const width = compact ? 100 : 680;
  const height = compact ? 24 : plotHeight;
  const left = compact ? 2 : 72;
  const right = width - (compact ? 2 : 18);
  const top = compact ? 3 : 12;
  const bottom = compact ? 21 : height - 34;
  const independent = series?.some((item) => item.min !== undefined) ?? false;
  const plots = (series ?? [{ id: 'signal', color: 'currentColor', points }]).map((item) => {
    const low = (item as { min?: number }).min ?? min;
    const high = (item as { max?: number }).max ?? max;
    // Scale before subtraction so finite values near +/- Number.MAX_VALUE stay drawable.
    const scale = Math.max(Math.abs(low), Math.abs(high), 1);
    const range = high / scale - low / scale;
    const coordinates = item.points.map(({ x, y, breakBefore }) => ({
      x: left + (x / (duration || 1)) * (right - left),
      y:
        range === 0
          ? (top + bottom) / 2
          : bottom - ((y / scale - low / scale) / range) * (bottom - top),
      breakBefore,
    }));
    const path = coordinates
      .map((point, index) =>
        index === 0 || point.breakBefore
          ? `M${point.x},${point.y}`
          : stepped
            ? `H${point.x}V${point.y}`
            : `L${point.x},${point.y}`,
      )
      .join(' ');
    return { ...item, coordinates, path };
  });
  return (
    <svg
      className={`line-plot${compact ? ' line-plot-compact' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      onPointerMove={
        onInspect
          ? (event) => {
              const svg = event.currentTarget;
              const matrix = svg.getScreenCTM();
              if (!matrix) return;
              const point = svg.createSVGPoint();
              point.x = event.clientX;
              point.y = event.clientY;
              onInspect(
                Math.max(
                  0,
                  Math.min(1, (point.matrixTransform(matrix.inverse()).x - left) / (right - left)),
                ),
              );
            }
          : undefined
      }
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
                {independent
                  ? `${100 - index * 25}%`
                  : axisNumber(max * (1 - index / 4) + min * (index / 4))}
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
              <text
                x={left + (index * (right - left)) / 3}
                y={height - 8}
                textAnchor={
                  formatX && index === 3 ? 'end' : formatX && index === 0 ? 'start' : 'middle'
                }
              >
                {formatX
                  ? formatX((duration * index) / 3)
                  : `${axisNumber((duration * index) / 3000)} s`}
              </text>
            </g>
          ))}
        </>
      )}
      {plots.map((plot) => (
        <g key={plot.id}>
          <path
            d={plot.path}
            fill="none"
            stroke={plot.color}
            strokeWidth={compact ? 1.5 : 2}
            strokeLinejoin="round"
          />
          {plot.coordinates.map((point, index) =>
            (index === 0 || point.breakBefore) &&
            (index === plot.coordinates.length - 1 || plot.coordinates[index + 1].breakBefore) ? (
              <circle key={index} cx={point.x} cy={point.y} r={2} fill={plot.color} />
            ) : null,
          )}
        </g>
      ))}
    </svg>
  );
}
