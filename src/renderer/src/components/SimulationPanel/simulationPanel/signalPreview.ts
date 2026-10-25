import { generateValue } from '../../../utils/valueGenerators';
import { defaultConfig, validateOutput } from './model';
import type { DeviceOutput } from './types';

export const periodicGenerators = ['sine', 'square', 'triangle', 'sawtooth'];
export const transitionGenerators = ['ramp', 'step', 'response'];

/** A local, repeatable preview; never consumes the live generator's random/state sequence. */
export function sampleSignalPreview(output: DeviceOutput, compact = false) {
  if (!['number', 'boolean'].includes(output.dataType) || validateOutput(output).length)
    return null;
  const config = { ...defaultConfig(output.dataType, output.generator), ...output.config };
  const periodic = periodicGenerators.includes(output.generator);
  const transition = transitionGenerators.includes(output.generator);
  const duration =
    periodic && config.frequency > 0
      ? 3000 / config.frequency
      : transition
        ? config.delayMs +
          (output.generator === 'ramp'
            ? config.durationMs * 1.2
            : output.generator === 'response'
              ? config.timeConstantMs * 5
              : Math.max(1000, config.delayMs / 2))
        : output.generator === 'pattern'
          ? config.intervalMs * config.sequence.length * 3
          : 3000;
  if (!Number.isFinite(duration)) return null;
  const count = periodic ? (compact ? 121 : 601) : transition ? 121 : 49;
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let previousValue: any;
  try {
    const times = Array.from({ length: count }, (_, index) => (duration * index) / (count - 1));
    if (transition) {
      times.push(config.delayMs);
      if (output.generator === 'ramp') times.push(config.delayMs + config.durationMs);
      if (output.generator === 'response')
        for (let index = 1; index <= 60; index++)
          times.push(config.delayMs + (config.timeConstantMs * 5 * index) / 60);
    }
    const points = [...new Set(times)]
      .sort((a, b) => a - b)
      .map((x, index) => {
        previousValue = generateValue(
          { ...output, config },
          {
            elapsedMs: x,
            sampleIndex: index,
            previousValue,
            random,
            unrounded: true,
          },
        );
        return { x, y: Number(previousValue) };
      });
    if (points.some(({ y }) => !Number.isFinite(y))) return null;
    // An axis-free pattern should remain recognizable even with very wide counter bounds.
    const useSampleRange = compact && ['counter', 'walk'].includes(output.generator);
    const min =
      output.dataType === 'boolean'
        ? 0
        : transition
          ? Math.min(config.start, config.end)
          : ((!useSampleRange ? config.min : undefined) ?? Math.min(...points.map((p) => p.y)));
    const max =
      output.dataType === 'boolean'
        ? 1
        : transition
          ? Math.max(config.start, config.end)
          : ((!useSampleRange ? config.max : undefined) ?? Math.max(...points.map((p) => p.y)));
    return { points, min, max, duration, periodic, frequency: config.frequency };
  } catch {
    return null;
  }
}
