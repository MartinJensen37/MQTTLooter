import { useMemo } from 'react';
import LinePlot from '../../Charts/LinePlot';
import { periodicGenerators, sampleSignalPreview } from './signalPreview';
import type { DeviceOutput } from './types';

export default function SignalWaveform({ output }: { output: DeviceOutput }) {
  const plot = useMemo(
    () => (periodicGenerators.includes(output.generator) ? sampleSignalPreview(output) : null),
    [output],
  );
  if (!plot) return null;
  return (
    <figure className="signal-waveform">
      <LinePlot
        {...plot}
        stepped={output.generator === 'square'}
        label={`${output.generator} waveform, ${plot.min} to ${plot.max}${output.unit ? ` ${output.unit}` : ''}, ${plot.frequency > 0 ? 'three cycles' : 'constant'}`}
      />
      <figcaption>
        {plot.min} to {plot.max}
        {output.unit ? ` ${output.unit}` : ''} /{' '}
        {plot.frequency > 0 ? 'Three cycles' : 'Constant phase at 0 Hz'}
      </figcaption>
    </figure>
  );
}
