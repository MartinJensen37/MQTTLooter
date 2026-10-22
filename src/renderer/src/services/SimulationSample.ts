import { generateSignalSample } from '../utils/valueGenerators';
import { defaultConfig, validateDevice } from '../components/SimulationPanel/simulationPanel/model';
import type { SimulatedDevice } from '../components/SimulationPanel/simulationPanel/types';

export interface SignalState {
  signature: string;
  sampleIndex: number;
  value: any;
  startedAt: number;
}
export interface SimulationSample {
  payload: string;
  topic?: string;
  values: Record<number, any>;
}

export function sampleDevice(
  device: SimulatedDevice,
  elapsedMs = 0,
  previous = new Map<number, SignalState>(),
  random = Math.random,
  timestamp = new Date().toISOString(),
  signalOriginMs = elapsedMs,
) {
  const errors = validateDevice(device);
  if (errors.length) throw new Error(errors[0]);
  const next = new Map<number, SignalState>();
  const values: Record<number, any> = {};
  const entries = device.outputs.map((output) => {
    const signature = JSON.stringify([output.dataType, output.generator, output.config]);
    const old = previous.get(output.id);
    const state =
      old?.signature === signature
        ? old
        : { signature, sampleIndex: 0, value: undefined, startedAt: signalOriginMs };
    const { value, rawValue } = generateSignalSample(
      {
        ...output,
        config: { ...defaultConfig(output.dataType, output.generator), ...output.config },
      },
      {
        elapsedMs: elapsedMs - state.startedAt,
        sampleIndex: state.sampleIndex,
        previousValue: state.value,
        random,
      },
    );
    next.set(output.id, { ...state, sampleIndex: state.sampleIndex + 1, value: rawValue });
    values[output.id] = value;
    return [
      output.name.trim(),
      {
        value,
        ...(output.dataType === 'number' && output.unit?.trim()
          ? { unit: output.unit.trim() }
          : {}),
        ...(output.includeTimestamp !== false ? { timestamp } : {}),
      },
    ] as const;
  });
  const payload = JSON.stringify(
    (device.payloadFormat ?? 'auto') === 'auto' && entries.length === 1
      ? entries[0][1]
      : Object.fromEntries(entries),
  );
  return { payload, values, next };
}

export interface SimulationCallbacks {
  publish: (message: {
    topic: string;
    payload: string;
    qos: number;
    retain: boolean;
  }) => Promise<void> | void;
  sample: (id: number, sample: SimulationSample) => void;
  error: (id: number, message: string) => void;
  busy?: (id: number, busy: boolean) => void;
}
