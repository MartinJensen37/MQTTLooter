import { useMemo } from 'react';
import LinePlot from '../../Charts/LinePlot';
import { periodicGenerators, transitionGenerators, sampleSignalPreview } from './signalPreview';
import type { DeviceOutput } from './types';

export default function SignalWaveform({ output }: { output: DeviceOutput }) {
  const plot = useMemo(
    () =>
      [...periodicGenerators, ...transitionGenerators].includes(output.generator)
        ? sampleSignalPreview(output)
        : null,
    [output],
  );
  if (!plot) return null;
  const description = plot.periodic
    ? plot.frequency > 0
      ? 'three cycles'
      : 'constant'
    : 'transition';
  return (
    <figure className="signal-waveform">
      <LinePlot
        {...plot}
        stepped={['square', 'step'].includes(output.generator)}
        label={`${output.generator} waveform, ${plot.min} to ${plot.max}${output.unit ? ` ${output.unit}` : ''}, ${description}`}
      />
      <figcaption>
        {plot.min} to {plot.max}
        {output.unit ? ` ${output.unit}` : ''} /{' '}
        {plot.periodic
          ? plot.frequency > 0
            ? 'Three cycles'
            : 'Constant phase at 0 Hz'
          : 'Transition'}
      </figcaption>
    </figure>
  );
}
