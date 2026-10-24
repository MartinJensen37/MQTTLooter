import { generateSignalSample } from '../utils/valueGenerators';
import { defaultConfig, validateDevice } from '../components/SimulationPanel/simulationPanel/model';
import type {
  SimulatedDevice,
  SimulationPayloadMode,
} from '../components/SimulationPanel/simulationPanel/types';

export interface SignalState {
  signature: string;
  sampleIndex: number;
  value: any;
  startedAt: number;
}
export interface SimulationSample {
  payloadMode?: SimulationPayloadMode;
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
  let payload: string;
  if (device.payloadMode === 'raw') {
    if (entries.length !== 1)
      throw new Error('Raw output requires exactly one signal per message.');
    const value = entries[0][1].value;
    if (
      !['string', 'number', 'boolean'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value))
    )
      throw new Error('Raw output requires a finite number, boolean or string.');
    payload = String(value);
    for (const character of payload) {
      const code = character.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff)
        throw new Error('Raw text contains an unpaired Unicode surrogate.');
    }
  } else
    payload = JSON.stringify(
      (device.payloadFormat ?? 'auto') === 'auto' && entries.length === 1
        ? entries[0][1]
        : Object.fromEntries(entries),
    );
  return { payload, payloadMode: device.payloadMode ?? 'json', values, next };
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
