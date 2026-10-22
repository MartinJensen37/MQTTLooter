import { generateValue } from '../../../utils/valueGenerators';
import { defaultConfig, validateOutput } from './model';
import type { DeviceOutput } from './types';

export const periodicGenerators = ['sine', 'square', 'triangle', 'sawtooth'];

/** A local, repeatable preview; never consumes the live generator's random/state sequence. */
export function sampleSignalPreview(output: DeviceOutput, compact = false) {
  if (!['number', 'boolean'].includes(output.dataType) || validateOutput(output).length)
    return null;
  const config = { ...defaultConfig(output.dataType, output.generator), ...output.config };
  const periodic = periodicGenerators.includes(output.generator);
  const duration =
    periodic && config.frequency > 0
      ? 3000 / config.frequency
      : output.generator === 'pattern'
        ? config.intervalMs * config.sequence.length * 3
        : 3000;
  if (!Number.isFinite(duration)) return null;
  const count = periodic ? (compact ? 121 : 601) : 49;
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let previousValue: any;
  try {
    const points = Array.from({ length: count }, (_, index) => {
      const x = (duration * index) / (count - 1);
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
        : ((!useSampleRange ? config.min : undefined) ?? Math.min(...points.map((p) => p.y)));
    const max =
      output.dataType === 'boolean'
        ? 1
        : ((!useSampleRange ? config.max : undefined) ?? Math.max(...points.map((p) => p.y)));
    return { points, min, max, duration, periodic, frequency: config.frequency };
  } catch {
    return null;
  }
}
