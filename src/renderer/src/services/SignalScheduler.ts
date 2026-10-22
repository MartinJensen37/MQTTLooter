import type {
  DeviceOutput,
  SimulatedDevice,
} from '../components/SimulationPanel/simulationPanel/types';
import { signalTopic, validateDevice } from '../components/SimulationPanel/simulationPanel/model';
import { sampleDevice, type SignalState, type SimulationCallbacks } from './SimulationSample';

interface Lane {
  signature: string;
  due: number;
  state: Map<number, SignalState>;
}
interface Run {
  epoch: number;
  running: boolean;
  lanes: Map<number, Lane>;
  timer?: ReturnType<typeof setTimeout>;
}

/** Absolute deadlines share a device clock; late or busy ticks are dropped, never queued. */
export class SignalScheduler {
  private devices = new Map<number, SimulatedDevice>();
  private runs = new Map<number, Run>();
  private pending = new Set<string>();
  private connected = false;
  private disposed = false;
  constructor(
    private callbacks: SimulationCallbacks,
    private now: () => number,
    private random: () => number,
  ) {}

  has(id: number) {
    return this.devices.has(id);
  }
  private key(id: number, signal: number) {
    return `${id}:${signal}`;
  }
  private period(device: SimulatedDevice, output: DeviceOutput) {
    return !output.timing || output.timing.mode === 'sync'
      ? device.publishInterval
      : output.timing.intervalMs!;
  }
  private delay(device: SimulatedDevice, output: DeviceOutput) {
    const period = this.period(device, output);
    return output.timing?.mode === 'random'
      ? Math.max(
          100,
          period * (1 + ((this.random() * 2 - 1) * (output.timing.jitterPercent ?? 20)) / 100),
        )
      : period;
  }
  private busy(id: number) {
    return [...this.pending].some((key) => key.startsWith(`${id}:`));
  }

  sync(devices: SimulatedDevice[], connected: boolean) {
    this.connected = connected;
    this.devices = new Map(devices.map((device) => [device.id, device]));
    for (const [id, run] of this.runs) {
      const device = this.devices.get(id);
      if (!connected || !device || (run.running && !device.isPublishing)) this.stop(id);
      else
        for (const signalId of run.lanes.keys())
          if (!device.outputs.some((output) => output.id === signalId)) run.lanes.delete(signalId);
    }
    if (!connected || this.disposed) return;
    for (const device of devices) {
      if (!device.isPublishing) continue;
      const errors = validateDevice(device);
      if (errors.length) {
        this.stop(device.id);
        this.callbacks.error(device.id, errors[0]);
        continue;
      }
      let run = this.runs.get(device.id);
      if (!run?.running) {
        this.stop(device.id);
        run = { epoch: this.now(), running: true, lanes: new Map() };
        this.runs.set(device.id, run);
      }
      this.updateLanes(device, run);
      this.schedule(device.id, run);
    }
  }

  private updateLanes(device: SimulatedDevice, run: Run) {
    for (const id of run.lanes.keys())
      if (!device.outputs.some((output) => output.id === id)) run.lanes.delete(id);
    for (const output of device.outputs) {
      const signature = JSON.stringify([this.period(device, output), output.timing]);
      const old = run.lanes.get(output.id);
      if (old?.signature === signature) continue;
      const period = this.period(device, output);
      const origin = run.epoch + (output.timing?.offsetMs ?? 0);
      const due =
        output.timing?.mode === 'random'
          ? Math.max(this.now(), origin) + this.delay(device, output)
          : origin + Math.max(1, Math.floor((this.now() - origin) / period) + 1) * period;
      if (old) {
        old.signature = signature;
        old.due = due;
      } else run.lanes.set(output.id, { signature, due, state: new Map() });
    }
  }

  private schedule(id: number, run: Run) {
    clearTimeout(run.timer);
    if (!run.running || !run.lanes.size || this.runs.get(id) !== run || this.disposed) return;
    const due = Math.min(...[...run.lanes.values()].map((lane) => lane.due));
    run.timer = setTimeout(() => this.tick(id, run), Math.max(1, Math.ceil(due - this.now())));
  }

  private tick(id: number, run: Run) {
    const device = this.devices.get(id);
    if (!device || !this.connected || this.runs.get(id) !== run || this.disposed) return;
    const now = this.now();
    const timestamp = new Date().toISOString();
    for (const output of device.outputs) {
      const lane = run.lanes.get(output.id);
      if (!lane || lane.due > now) continue;
      const period = this.period(device, output);
      lane.due =
        output.timing?.mode === 'random'
          ? now + this.delay(device, output)
          : lane.due + (Math.floor((now - lane.due) / period) + 1) * period;
      const probability = output.timing?.probability ?? 1;
      if (
        !this.pending.has(this.key(id, output.id)) &&
        probability > 0 &&
        (probability === 1 || this.random() < probability)
      )
        void this.send(device, output, run, lane, now, timestamp);
    }
    this.schedule(id, run);
  }

  private async send(
    device: SimulatedDevice,
    output: DeviceOutput,
    run: Run,
    lane: Lane,
    now: number,
    timestamp: string,
  ) {
    const key = this.key(device.id, output.id);
    if (this.pending.has(key) || this.runs.get(device.id) !== run) return;
    this.pending.add(key);
    this.callbacks.busy?.(device.id, true);
    try {
      const topic = signalTopic(device, output);
      const sample = sampleDevice(
        { ...device, publishMode: 'combined', topic, outputs: [output], payloadFormat: 'auto' },
        now - run.epoch,
        lane.state,
        this.random,
        timestamp,
        0,
      );
      await this.callbacks.publish({
        topic,
        payload: sample.payload,
        qos: device.qos ?? 0,
        retain: device.retain ?? false,
      });
      if (!this.disposed && this.runs.get(device.id) === run && run.lanes.get(output.id) === lane) {
        lane.state = sample.next;
        this.callbacks.sample(device.id, { payload: sample.payload, values: sample.values, topic });
      }
    } catch (error) {
      if (!this.disposed && this.runs.get(device.id) === run) {
        this.stop(device.id);
        this.callbacks.error(device.id, (error as Error).message);
      }
    } finally {
      this.pending.delete(key);
      if (!this.disposed) this.callbacks.busy?.(device.id, this.busy(device.id));
    }
  }

  async publishOnce(id: number) {
    const device = this.devices.get(id);
    if (!device || !this.connected || this.disposed || this.busy(id) || device.isPublishing) return;
    const errors = validateDevice(device);
    if (errors.length) {
      this.callbacks.error(id, errors[0]);
      return;
    }
    let run = this.runs.get(id);
    if (!run) {
      run = { epoch: this.now(), running: false, lanes: new Map() };
      this.runs.set(id, run);
    }
    this.updateLanes(device, run);
    const now = this.now();
    const timestamp = new Date().toISOString();
    await Promise.all(
      device.outputs.map((output) =>
        this.send(device, output, run!, run!.lanes.get(output.id)!, now, timestamp),
      ),
    );
  }

  stop(id: number) {
    clearTimeout(this.runs.get(id)?.timer);
    this.runs.delete(id);
  }
  dispose() {
    this.disposed = true;
    for (const id of this.runs.keys()) this.stop(id);
  }
}
