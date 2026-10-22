import { useMemo } from 'react';
import { generateValue } from '../../../utils/valueGenerators';
import { defaultConfig, validateOutput } from './model';
import type { DeviceOutput } from './types';

const axisNumber = (value: number) => Number(value.toPrecision(4)).toString();
export default function SignalWaveform({
  output,
  compact = false,
}: {
  output: DeviceOutput;
  compact?: boolean;
}) {
  const { dataType, generator, config: suppliedConfig, decimalPrecision } = output;
  const width = compact ? 400 : 680;
  const height = compact ? 88 : 152;
  const left = compact ? 48 : 72;
  const right = width - 18;
  const top = compact ? 8 : 12;
  const bottom = compact ? 60 : 118;
  const ticks = compact ? 2 : 4;
  const plot = useMemo(() => {
    const signal = {
      id: 0,
      name: 'preview',
      dataType,
      generator,
      config: suppliedConfig,
      decimalPrecision,
    };
    if (
      !['sine', 'square', 'triangle', 'sawtooth'].includes(generator) ||
      validateOutput(signal).length
    )
      return null;
    try {
      const config = { ...defaultConfig(dataType, generator), ...suppliedConfig };
      const duration = config.frequency > 0 ? 3000 / config.frequency : 3000;
      if (!Number.isFinite(duration)) return null;
      const range = config.max - config.min || 1;
      const points = Array.from({ length: 601 }, (_, index) => {
        const value = Number(
          generateValue(
            { ...signal, config },
            { elapsedMs: (duration * index) / 600, unrounded: true },
          ),
        );
        return `${left + (index / 600) * (right - left)},${bottom - ((value - config.min) / range) * (bottom - top)}`;
      }).join(' ');
      return { points, duration, min: config.min, max: config.max, frequency: config.frequency };
    } catch {
      return null;
    }
  }, [dataType, generator, suppliedConfig, decimalPrecision, left, right, top, bottom]);
  if (!plot) return null;
  return (
    <figure className={`signal-waveform${compact ? ' signal-waveform-compact' : ''}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${output.generator} waveform, ${plot.min} to ${plot.max}${output.unit ? ` ${output.unit}` : ''}, ${plot.frequency > 0 ? 'three cycles' : 'constant'}`}
      >
        {Array.from({ length: ticks + 1 }, (_, index) => index).map((index) => (
          <g key={index} className="wave-axis">
            <line
              x1={left}
              x2={right}
              y1={top + (index * (bottom - top)) / ticks}
              y2={top + (index * (bottom - top)) / ticks}
            />
            <text x={left - 8} y={top + (index * (bottom - top)) / ticks + 4} textAnchor="end">
              {axisNumber(plot.max - ((plot.max - plot.min) * index) / ticks)}
            </text>
          </g>
        ))}
        {[0, 1, 2, 3].map((index) => (
          <g key={index} className="wave-axis">
            <line
              x1={left + (index * (right - left)) / 3}
              x2={left + (index * (right - left)) / 3}
              y1={top}
              y2={bottom}
            />
            <text x={left + (index * (right - left)) / 3} y={height - 8} textAnchor="middle">
              {axisNumber((plot.duration * index) / 3000)} s
            </text>
          </g>
        ))}
        <polyline
          points={plot.points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <figcaption>
        {plot.min} to {plot.max}
        {output.unit ? ` ${output.unit}` : ''} /{' '}
        {plot.frequency > 0 ? 'Three cycles' : 'Constant phase at 0 Hz'}
      </figcaption>
    </figure>
  );
}
