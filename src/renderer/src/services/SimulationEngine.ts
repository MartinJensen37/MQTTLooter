import { validateDevice } from '../components/SimulationPanel/simulationPanel/model';
import type { SimulatedDevice } from '../components/SimulationPanel/simulationPanel/types';
import { sampleDevice, type SignalState, type SimulationCallbacks } from './SimulationSample';
import { SignalScheduler } from './SignalScheduler';
export { sampleDevice, type SimulationSample } from './SimulationSample';
interface Session {
  startedAt: number;
  signals: Map<number, SignalState>;
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
    clearTimeout(this.loops.get(id)?.timer);
    this.loops.delete(id);
    this.sessions.delete(id);
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
      await this.callbacks.publish({
        topic: device.topic,
        payload: sample.payload,
        qos: device.qos ?? 0,
        retain: device.retain ?? false,
      });
      if (!this.disposed && this.sessions.get(id) === session) {
        session.signals = sample.next;
        this.callbacks.sample(id, { ...sample, topic: device.topic });
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
