import { validateDevice } from '../components/SimulationPanel/simulationPanel/model';
import type {
  DeviceOutput,
  SimulatedDevice,
  SparkplugTarget,
} from '../components/SimulationPanel/simulationPanel/types';
import { sampleDevice, type SignalState, type SimulationCallbacks } from './SimulationSample';
import { SignalScheduler } from './SignalScheduler';
import {
  REBIRTH_METRIC,
  sparkplugTopic,
  type SparkplugMessageType,
  type SparkplugOutgoingMetric,
  type SparkplugOutgoingPayload,
} from '../../../shared/sparkplug';
export { sampleDevice, type SimulationSample } from './SimulationSample';
interface SparkplugSession {
  target: SparkplugTarget;
  seq: number;
  bdSeq: number;
}
interface Session {
  startedAt: number;
  signals: Map<number, SignalState>;
  /** Set once the session's births are published. */
  sparkplug?: SparkplugSession;
}

const SPARKPLUG_TYPES: Record<string, 'Double' | 'Boolean'> = {
  number: 'Double',
  boolean: 'Boolean',
};

/** A signal as a metric with a fixed type per data type; other values travel as text. */
function sparkplugMetric(
  output: DeviceOutput,
  value: unknown,
  alias: number,
): SparkplugOutgoingMetric {
  const type = SPARKPLUG_TYPES[output.dataType] ?? 'String';
  let converted: boolean | number | string | null = null;
  if (type === 'Double')
    converted = typeof value === 'number' && Number.isFinite(value) ? value : null;
  else if (type === 'Boolean') converted = typeof value === 'boolean' ? value : null;
  else if (value !== null && value !== undefined)
    converted = typeof value === 'string' ? value : JSON.stringify(value);
  return { name: output.name.trim(), alias, type, value: converted };
}
interface Loop {
  timer?: ReturnType<typeof setTimeout>;
  interval: number;
  session: Session;
}
/** Routes individual signal clocks and legacy completion-based device loops. */
export class SimulationEngine {
  private signalScheduler: SignalScheduler;
  private devices: SimulatedDevice[] = [];
  private connected = false;
  private disposed = false;
  private loops = new Map<number, Loop>();
  private sessions = new Map<number, Session>();
  private pending = new Set<number>();
  // Sparkplug birth/death sequence per device, counting across sessions.
  private bdSeq = new Map<number, number>();
  constructor(
    private callbacks: SimulationCallbacks,
    private now = () => performance.now(),
    random = Math.random,
  ) {
    this.signalScheduler = new SignalScheduler(callbacks, now, random);
  }

  sync(devices: SimulatedDevice[], connected: boolean) {
    this.signalScheduler.sync(
      devices.filter((device) => device.publishMode === 'signals'),
      connected,
    );
    devices = devices.filter((device) => device.publishMode !== 'signals');
    this.devices = devices;
    this.connected = connected;
    for (const id of this.sessions.keys())
      if (!connected || !devices.some((device) => device.id === id)) this.stopCombined(id);
    for (const [id] of this.loops)
      if (!connected || !devices.some((device) => device.id === id && device.isPublishing))
        this.stopCombined(id);
    if (!connected || this.disposed) return;
    for (const device of devices.filter((item) => item.isPublishing)) {
      const errors = validateDevice(device);
      if (errors.length) {
        this.stopCombined(device.id);
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
    this.signalScheduler.stop(id);
    this.stopCombined(id);
  }

  private stopCombined(id: number) {
    const sparkplug = this.sessions.get(id)?.sparkplug;
    clearTimeout(this.loops.get(id)?.timer);
    this.loops.delete(id);
    this.sessions.delete(id);
    // A stopped edge node announces its death; a lost connection cannot.
    if (sparkplug && this.connected && !this.disposed)
      void this.sendDeath(sparkplug).catch(() => {});
  }

  private async sendSparkplug(
    target: SparkplugTarget,
    messageType: SparkplugMessageType,
    payload: Omit<SparkplugOutgoingPayload, 'timestamp'>,
  ): Promise<string> {
    if (!this.callbacks.encodeSparkplug) throw new Error('Sparkplug B encoding is not available.');
    const topic = sparkplugTopic({
      group: target.group,
      edgeNode: target.edgeNode,
      messageType,
      device: messageType[0] === 'D' ? target.device : undefined,
    });
    const message = await this.callbacks.encodeSparkplug({ timestamp: Date.now(), ...payload });
    await this.callbacks.publish({
      topic,
      payload: message,
      encoding: 'base64',
      qos: 0,
      retain: false,
    });
    return topic;
  }

  /** The first publish of a session sends births with every signal; later ones send data by alias. */
  private async publishSparkplug(
    device: SimulatedDevice,
    session: Session,
    values: Record<number, unknown>,
  ): Promise<string> {
    const target = { ...device.sparkplug!, device: device.sparkplug!.device || undefined };
    const metrics = device.outputs.map((output, index) =>
      sparkplugMetric(output, values[output.id], index + 1),
    );
    let state = session.sparkplug;
    if (!state) {
      const bdSeq = this.bdSeq.get(device.id) ?? 0;
      this.bdSeq.set(device.id, (bdSeq + 1) % 256);
      state = { target, seq: 0, bdSeq };
      const control: SparkplugOutgoingMetric[] = [
        { name: 'bdSeq', type: 'UInt64', value: bdSeq },
        { name: REBIRTH_METRIC, type: 'Boolean', value: false },
      ];
      let topic = await this.sendSparkplug(target, 'NBIRTH', {
        seq: 0,
        metrics: target.device ? control : [...control, ...metrics],
      });
      if (target.device)
        topic = await this.sendSparkplug(target, 'DBIRTH', { seq: ++state.seq, metrics });
      session.sparkplug = state;
      return topic;
    }
    state.seq = (state.seq + 1) % 256;
    return this.sendSparkplug(target, target.device ? 'DDATA' : 'NDATA', {
      seq: state.seq,
      metrics: metrics.map((metric) => ({ ...metric, name: '' })),
    });
  }

  private async sendDeath({ target, seq, bdSeq }: SparkplugSession) {
    if (target.device)
      await this.sendSparkplug(target, 'DDEATH', { seq: (seq + 1) % 256, metrics: [] });
    await this.sendSparkplug(target, 'NDEATH', {
      metrics: [{ name: 'bdSeq', type: 'UInt64', value: bdSeq }],
    });
  }

  async publishOnce(id: number) {
    if (this.signalScheduler.has(id)) return this.signalScheduler.publishOnce(id);
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
      let topic = device.topic;
      if (device.sparkplug) topic = await this.publishSparkplug(device, session, sample.values);
      else
        await this.callbacks.publish({
          topic,
          payload: sample.payload,
          qos: device.qos ?? 0,
          retain: device.retain ?? false,
        });
      if (!this.disposed && this.sessions.get(id) === session) {
        session.signals = sample.next;
        this.callbacks.sample(id, { ...sample, topic });
      }
    } catch (error) {
      if (!this.disposed && this.sessions.get(id) === session) {
        this.stopCombined(id);
        this.callbacks.error(id, (error as Error).message);
      }
    } finally {
      this.pending.delete(id);
      if (!this.disposed) this.callbacks.busy?.(id, false);
    }
  }

  dispose() {
    this.disposed = true;
    this.signalScheduler.dispose();
    for (const id of this.sessions.keys()) this.stopCombined(id);
  }
}
