import { memo, useMemo } from 'react';
import LinePlot from '../../Charts/LinePlot';
import { GENERATOR_CONFIGS } from './constants';
import { sampleSignalPreview } from './signalPreview';
import type { DeviceOutput } from './types';

export default memo(function SignalSparkline({ output }: { output: DeviceOutput }) {
  const plot = useMemo(() => sampleSignalPreview(output, true), [output]);
  const label = GENERATOR_CONFIGS[output.generator]?.label ?? output.generator;
  return (
    <span
      className="signal-row-pattern"
      title={`${label}${plot && !plot.periodic ? ' (representative samples)' : ''}`}
    >
      {plot ? (
        <LinePlot
          {...plot}
          label={`${label}, ${plot.periodic && plot.frequency > 0 ? 'three cycles' : 'representative pattern'}`}
          compact
          stepped={output.dataType === 'boolean' || output.generator === 'square'}
        />
      ) : (
        <span className="signal-pattern-label">{label}</span>
      )}
    </span>
  );
});
