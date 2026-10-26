import type { PointerEvent } from 'react';
import './LinePlot.css';

export interface PlotPoint {
  x: number;
  y: number;
  breakBefore?: boolean;
}
/** A line at `x` with a dot on each listed series sample; x values use the plot's time units. */
export interface PlotMarker {
  x: number;
  points: { id: string; x: number; y: number }[];
}
/** Horizontal layout of a full-size plot in its viewBox, for placing overlays next to it. */
export const PLOT_FRAME = { width: 680, left: 72, right: 662 };
/** The layout for a plot drawn `width` units wide; wider plots keep their height. */
export const plotFrame = (width = PLOT_FRAME.width) => ({
  width,
  left: PLOT_FRAME.left,
  right: width - (PLOT_FRAME.width - PLOT_FRAME.right),
});
/** Space between the data and the frame, so lines at the extremes are not cut by it. */
const INSET = 10;
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
  plotWidth = PLOT_FRAME.width,
  formatX,
  marker,
  onInspect,
  onLeave,
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
  /** Drawing width; set it to the rendered pixel width so a wide plot keeps its height. */
  plotWidth?: number;
  formatX?: (value: number) => string;
  marker?: PlotMarker;
  /** Pointer position as a fraction of the time axis. */
  onInspect?: (fraction: number, event: PointerEvent<SVGSVGElement>) => void;
  onLeave?: () => void;
}) {
  const frame = plotFrame(plotWidth);
  const width = compact ? 100 : frame.width;
  const height = compact ? 24 : plotHeight;
  const left = compact ? 2 : frame.left;
  const right = compact ? width - 2 : frame.right;
  const toX = (x: number) => left + (x / (duration || 1)) * (right - left);
  const top = compact ? 3 : 12;
  const bottom = compact ? 21 : height - 34;
  // The value range is drawn inside the frame; value grid lines follow it.
  const dataTop = compact ? top : top + INSET;
  const dataBottom = compact ? bottom : bottom - INSET;
  const columns = Math.max(3, Math.round((right - left) / 200));
  const independent = series?.some((item) => item.min !== undefined) ?? false;
  const plots = (series ?? [{ id: 'signal', color: 'currentColor', points }]).map((item) => {
    const low = (item as { min?: number }).min ?? min;
    const high = (item as { max?: number }).max ?? max;
    // Scale before subtraction so finite values near +/- Number.MAX_VALUE stay drawable.
    const scale = Math.max(Math.abs(low), Math.abs(high), 1);
    const range = high / scale - low / scale;
    const toY = (y: number) =>
      range === 0
        ? (dataTop + dataBottom) / 2
        : dataBottom - ((y / scale - low / scale) / range) * (dataBottom - dataTop);
    const coordinates = item.points.map(({ x, y, breakBefore }) => ({
      x: toX(x),
      y: toY(y),
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
    return { ...item, coordinates, path, toY };
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
                event,
              );
            }
          : undefined
      }
      onPointerLeave={onLeave}
    >
      {!compact && (
        <>
          {[0, 1, 2, 3, 4].map((index) => (
            <g key={index} className="line-plot-axis">
              <line
                x1={left}
                x2={right}
                y1={dataTop + (index * (dataBottom - dataTop)) / 4}
                y2={dataTop + (index * (dataBottom - dataTop)) / 4}
              />
              <text
                x={left - 8}
                y={dataTop + (index * (dataBottom - dataTop)) / 4 + 4}
                textAnchor="end"
              >
                {independent
                  ? `${100 - index * 25}%`
                  : axisNumber(max * (1 - index / 4) + min * (index / 4))}
              </text>
            </g>
          ))}
          {Array.from({ length: columns + 1 }, (_, index) => (
            <g key={index} className="line-plot-axis">
              <line
                x1={left + (index * (right - left)) / columns}
                x2={left + (index * (right - left)) / columns}
                y1={top}
                y2={bottom}
              />
              <text
                x={left + (index * (right - left)) / columns}
                y={height - 8}
                textAnchor={
                  formatX && index === columns ? 'end' : formatX && index === 0 ? 'start' : 'middle'
                }
              >
                {formatX
                  ? formatX((duration * index) / columns)
                  : `${axisNumber((duration * index) / (columns * 1000))} s`}
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
              <circle key={index} cx={point.x} cy={point.y} r={compact ? 2 : 3} fill={plot.color} />
            ) : null,
          )}
        </g>
      ))}
      {marker && (
        <g className="line-plot-marker">
          <line x1={toX(marker.x)} x2={toX(marker.x)} y1={top} y2={bottom} />
          {marker.points.map((point) => {
            const plot = plots.find((item) => item.id === point.id);
            return plot ? (
              <circle
                key={point.id}
                cx={toX(point.x)}
                cy={plot.toY(point.y)}
                r={4.5}
                fill={plot.color}
              />
            ) : null;
          })}
        </g>
      )}
    </svg>
  );
}
