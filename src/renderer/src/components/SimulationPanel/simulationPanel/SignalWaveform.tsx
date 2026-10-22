import { useMemo } from 'react';
import { generateValue } from '../../../utils/valueGenerators';
import { defaultConfig, validateOutput } from './model';
import type { DeviceOutput } from './types';

const axisNumber = (value: number) => Number(value.toPrecision(4)).toString();
export default function SignalWaveform({ output }: { output: DeviceOutput }) {
  const { dataType, generator, config: suppliedConfig, decimalPrecision } = output;
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
        return `${86 + index * 0.94},${170 - ((value - config.min) / range) * 150}`;
      }).join(' ');
      return { points, duration, min: config.min, max: config.max, frequency: config.frequency };
    } catch {
      return null;
    }
  }, [dataType, generator, suppliedConfig, decimalPrecision]);
  if (!plot) return null;
  return (
    <figure className="signal-waveform">
      <svg
        viewBox="0 0 680 210"
        role="img"
        aria-label={`${output.generator} waveform, ${plot.min} to ${plot.max}${output.unit ? ` ${output.unit}` : ''}, ${plot.frequency > 0 ? 'three cycles' : 'constant'}`}
      >
        {[0, 1, 2, 3, 4].map((index) => (
          <g key={index} className="wave-axis">
            <line x1="86" x2="650" y1={20 + index * 37.5} y2={20 + index * 37.5} />
            <text x="76" y={24 + index * 37.5} textAnchor="end">
              {axisNumber(plot.max - ((plot.max - plot.min) * index) / 4)}
            </text>
          </g>
        ))}
        {[0, 1, 2, 3].map((index) => (
          <g key={index} className="wave-axis">
            <line x1={86 + index * 188} x2={86 + index * 188} y1="20" y2="170" />
            <text x={86 + index * 188} y="194" textAnchor="middle">
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
