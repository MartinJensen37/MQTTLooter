import type { DeviceOutput } from '../components/SimulationPanel/simulationPanel/types';

export function signalPeriod(devicePeriod: number, timing?: DeviceOutput['timing']) {
  return !timing || timing.mode === 'sync' ? devicePeriod : timing.intervalMs!;
}

/** The same bounded delay rule is used by the live scheduler and its independent preview. */
export function signalDelay(period: number, timing: DeviceOutput['timing'], random: () => number) {
  return timing?.mode === 'random'
    ? Math.max(100, period * (1 + ((random() * 2 - 1) * (timing.jitterPercent ?? 20)) / 100))
    : period;
}
