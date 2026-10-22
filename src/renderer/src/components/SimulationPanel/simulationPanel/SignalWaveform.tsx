import { useMemo } from 'react';
import { generateValue } from '../../../utils/valueGenerators';
import { validateOutput } from './model';
import type { DeviceOutput } from './types';

export default function SignalWaveform({ output }: { output: DeviceOutput }) {
  const points = useMemo(() => {
    if (
      !['sine', 'square', 'triangle', 'sawtooth'].includes(output.generator) ||
      validateOutput(output).length
    )
      return null;
    try {
      const duration = output.config.frequency > 0 ? 1000 / output.config.frequency : 1000;
      const range = output.config.max - output.config.min || 1;
      return Array.from({ length: 65 }, (_, index) => {
        const value = generateValue(output, { elapsedMs: (duration * index) / 64 });
        return `${index * 5},${72 - ((Number(value) - output.config.min) / range) * 64}`;
      }).join(' ');
    } catch {
      return null;
    }
  }, [output]);
  if (!points) return null;
  return (
    <figure className="signal-waveform">
      <svg viewBox="0 0 320 80" role="img" aria-label={`${output.generator} waveform preview`}>
        <path d="M0 72H320 M0 8H320" stroke="currentColor" opacity="0.15" />
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      <figcaption>
        {output.config.min} to {output.config.max}
        {output.unit ? ` ${output.unit}` : ''};{' '}
        {output.config.frequency > 0 ? 'one cycle' : 'constant phase at 0 Hz'}.
      </figcaption>
    </figure>
  );
}
