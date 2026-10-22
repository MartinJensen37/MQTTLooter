import { generateSignalSample } from '../utils/valueGenerators';
import { defaultConfig, validateDevice } from '../components/SimulationPanel/simulationPanel/model';
import type { SimulatedDevice } from '../components/SimulationPanel/simulationPanel/types';

interface SignalState {
  signature: string;
  sampleIndex: number;
  value: any;
  startedAt: number;
}
interface Session {
  startedAt: number;
  signals: Map<number, SignalState>;
}
interface Loop {
  timer?: ReturnType<typeof setTimeout>;
  interval: number;
  session: Session;
}
export interface SimulationSample {
  payload: string;
  values: Record<number, any>;
}

export function sampleDevice(
  device: SimulatedDevice,
  elapsedMs = 0,
  previous = new Map<number, SignalState>(),
  random = Math.random,
  timestamp = new Date().toISOString(),
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
        : { signature, sampleIndex: 0, value: undefined, startedAt: elapsedMs };
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

/** A bounded, completion-based scheduler: one in-flight publish per device, no backlog. */
export class SimulationEngine {
  private devices: SimulatedDevice[] = [];
  private connected = false;
  private disposed = false;
  private loops = new Map<number, Loop>();
  private sessions = new Map<number, Session>();
  private pending = new Set<number>();
  constructor(
    private callbacks: {
      publish: (message: {
        topic: string;
        payload: string;
        qos: number;
        retain: boolean;
      }) => Promise<void> | void;
      sample: (id: number, sample: SimulationSample) => void;
      error: (id: number, message: string) => void;
      busy?: (id: number, busy: boolean) => void;
    },
    private now = () => performance.now(),
  ) {}

  sync(devices: SimulatedDevice[], connected: boolean) {
    this.devices = devices;
    this.connected = connected;
    for (const id of this.sessions.keys())
      if (!connected || !devices.some((device) => device.id === id)) this.stop(id);
    for (const [id] of this.loops)
      if (!connected || !devices.some((device) => device.id === id && device.isPublishing))
        this.stop(id);
    if (!connected || this.disposed) return;
    for (const device of devices.filter((item) => item.isPublishing)) {
      const errors = validateDevice(device);
      if (errors.length) {
        this.stop(device.id);
        this.callbacks.error(device.id, errors[0]);
        continue;
      }
      let loop = this.loops.get(device.id);
      if (!loop) {
        const session = { startedAt: this.now(), signals: new Map() };
        this.sessions.set(device.id, session);
        loop = { interval: device.publishInterval, session };
        this.loops.set(device.id, loop);
        this.schedule(device.id, loop);
      } else if (loop.interval !== device.publishInterval) {
        loop.interval = device.publishInterval;
        if (loop.timer !== undefined) {
          clearTimeout(loop.timer);
          this.schedule(device.id, loop);
        }
      }
    }
  }

  private schedule(id: number, loop: Loop) {
    loop.timer = setTimeout(async () => {
      loop.timer = undefined;
      await this.publishOnce(id);
      if (this.loops.get(id) === loop && !this.disposed) this.schedule(id, loop);
    }, loop.interval);
  }

  stop(id: number) {
    clearTimeout(this.loops.get(id)?.timer);
    this.loops.delete(id);
    this.sessions.delete(id);
  }

  async publishOnce(id: number) {
    const device = this.devices.find((item) => item.id === id);
    if (!device || !this.connected || this.disposed || this.pending.has(id)) return;
    let session = this.sessions.get(id);
    if (!session) {
      session = { startedAt: this.now(), signals: new Map() };
      this.sessions.set(id, session);
    }
    this.pending.add(id);
    this.callbacks.busy?.(id, true);
    try {
      const sample = sampleDevice(device, this.now() - session.startedAt, session.signals);
      await this.callbacks.publish({
        topic: device.topic,
        payload: sample.payload,
        qos: device.qos ?? 0,
        retain: device.retain ?? false,
      });
      if (!this.disposed && this.sessions.get(id) === session) {
        session.signals = sample.next;
        this.callbacks.sample(id, sample);
      }
    } catch (error) {
      if (!this.disposed && this.sessions.get(id) === session) {
        this.stop(id);
        this.callbacks.error(id, (error as Error).message);
      }
    } finally {
      this.pending.delete(id);
      if (!this.disposed) this.callbacks.busy?.(id, false);
    }
  }

  dispose() {
    this.disposed = true;
    for (const id of this.sessions.keys()) this.stop(id);
  }
}
