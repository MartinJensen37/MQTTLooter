// Pure value generators for simulated device outputs. No component state — given a
// generator name and its config they return a single value, so they're easy to test.

function generateNumberValue(generator, config, decimalPrecision = 2, context) {
  let value;

  switch (generator) {
    case 'static':
      value = config.value ?? 0;
      break;

    case 'uniform': {
      const range = (config.max ?? 100) - (config.min ?? 0);
      value = (config.min ?? 0) + context.random() * range;
      break;
    }

    case 'normal': {
      // Box–Muller transform for a normal distribution.
      const u1 = Math.max(Number.MIN_VALUE, context.random());
      const u2 = context.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      value = (config.mean ?? 0) + z0 * (config.stdDev ?? 1);
      if (config.min !== undefined) value = Math.max(value, config.min);
      if (config.max !== undefined) value = Math.min(value, config.max);
      break;
    }

    case 'sine': {
      const time = context.elapsedMs / 1000;
      const amplitude = ((config.max ?? 100) - (config.min ?? 0)) / 2;
      const offset = (config.min ?? 0) + amplitude;
      const frequency = config.frequency ?? 0.1;
      value =
        offset +
        amplitude * Math.sin(2 * Math.PI * frequency * time + 2 * Math.PI * (config.phase ?? 0));
      break;
    }

    case 'square':
    case 'triangle':
    case 'sawtooth': {
      const cycle = (context.elapsedMs / 1000) * (config.frequency ?? 0.1) + (config.phase ?? 0);
      const phase = ((cycle % 1) + 1) % 1;
      const fraction =
        generator === 'square'
          ? phase < (config.dutyCycle ?? 0.5)
            ? 1
            : 0
          : generator === 'triangle'
            ? 1 - Math.abs(2 * phase - 1)
            : phase;
      value = (config.min ?? 0) + ((config.max ?? 100) - (config.min ?? 0)) * fraction;
      break;
    }
    case 'ramp':
    case 'step':
    case 'response': {
      const start = config.start ?? 0;
      const end = config.end ?? 100;
      const elapsed = context.elapsedMs - (config.delayMs ?? (generator === 'ramp' ? 0 : 1000));
      const fraction =
        elapsed < 0
          ? 0
          : generator === 'step'
            ? 1
            : generator === 'ramp'
              ? Math.min(1, elapsed / (config.durationMs ?? 5000))
              : -Math.expm1(-elapsed / (config.timeConstantMs ?? 1000));
      // Weighted endpoints avoid overflowing end - start for large opposite values.
      value = start * (1 - fraction) + end * fraction;
      break;
    }
    case 'counter':
      value = (config.start ?? 0) + context.sampleIndex * (config.step ?? 1);
      value = Math.max(config.min ?? 0, Math.min(config.max ?? 100, value));
      break;
    case 'walk':
      value =
        context.previousValue === undefined
          ? (config.start ?? 0)
          : context.previousValue + (context.random() * 2 - 1) * (config.step ?? 1);
      value = Math.max(config.min ?? 0, Math.min(config.max ?? 100, value));
      break;
    case 'exponential': {
      const lambda = config.lambda ?? 1;
      value = -Math.log(1 - context.random()) / lambda;
      if (config.min !== undefined) value = Math.max(value, config.min);
      if (config.max !== undefined) value = Math.min(value, config.max);
      break;
    }

    default:
      value = config.min ?? 0;
  }

  if (!Number.isFinite(value)) throw new Error('Signal produced a non-finite number');
  if (context.unrounded) return value;
  return Number(value.toFixed(decimalPrecision ?? 2));
}

function generateBooleanValue(generator, config, context) {
  switch (generator) {
    case 'static':
      return Boolean(config.value);

    case 'probability':
      return context.random() < (config.trueProbability ?? 0.5);

    case 'pattern': {
      if (!Array.isArray(config.sequence) || config.sequence.length === 0) {
        return context.random() > 0.5;
      }
      const index =
        Math.floor(context.elapsedMs / (config.intervalMs || 5000)) % config.sequence.length;
      return Boolean(config.sequence[index]);
    }

    default:
      return context.random() > 0.5;
  }
}

function generateStringValue(generator, config, context) {
  switch (generator) {
    case 'static':
      return String(config.value ?? 'default');

    case 'list':
    case 'random': {
      if (!Array.isArray(config.values) || config.values.length === 0) {
        return 'default';
      }
      return config.values[Math.floor(context.random() * config.values.length)];
    }

    case 'pattern': {
      if (!Array.isArray(config.sequence) || !config.sequence.length) return '';
      return String(
        config.sequence[
          Math.floor(context.elapsedMs / Math.max(1, config.intervalMs ?? 5000)) %
            config.sequence.length
        ],
      );
    }

    case 'weighted': {
      if (!Array.isArray(config.weightedValues) || config.weightedValues.length === 0) {
        return 'default';
      }
      const totalWeight = config.weightedValues.reduce(
        (sum, item) => sum + Math.max(0, item.weight ?? 1),
        0,
      );
      let random = context.random() * totalWeight;
      for (const item of config.weightedValues) {
        random -= Math.max(0, item.weight ?? 1);
        if (random < 0) return item.value;
      }
      return config.weightedValues[0].value;
    }

    default:
      return 'default';
  }
}

function generateEnumValue(generator, config, context) {
  return generateStringValue(generator, config, context);
}

/**
 * Generate one value for a device output based on its dataType/generator/config.
 * @param {{ dataType: string, generator: string, config: object, decimalPrecision?: number }} output
 */
export function generateValue(output, options = {}) {
  const context = {
    elapsedMs: 0,
    sampleIndex: 0,
    previousValue: undefined,
    random: Math.random,
    ...options,
  };
  const { dataType, generator, config, decimalPrecision } = output;

  switch (dataType) {
    case 'number':
      return generateNumberValue(generator, config, decimalPrecision, context);
    case 'boolean':
      return generateBooleanValue(generator, config, context);
    case 'string':
      return generateStringValue(generator, config, context);
    case 'enum':
      return generateEnumValue(generator, config, context);
    default:
      return 0;
  }
}

/** Retain full precision in stateful signals; round only the value sent to MQTT. */
export function generateSignalSample(output, options = {}) {
  const rawValue = generateValue(output, { ...options, unrounded: true });
  return {
    rawValue,
    value:
      typeof rawValue === 'number'
        ? Number(rawValue.toFixed(output.decimalPrecision ?? 2))
        : rawValue,
  };
}
