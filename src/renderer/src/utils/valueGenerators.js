// Pure value generators for simulated device outputs. No component state — given a
// generator name and its config they return a single value, so they're easy to test.

function generateNumberValue(generator, config, decimalPrecision = 2) {
  let value;

  switch (generator) {
    case 'static':
      value = config.value || 0;
      break;

    case 'uniform': {
      const range = (config.max || 100) - (config.min || 0);
      value = (config.min || 0) + Math.random() * range;
      break;
    }

    case 'normal': {
      // Box–Muller transform for a normal distribution.
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      value = (config.mean || 0) + z0 * (config.stdDev || 1);
      if (config.min !== undefined) value = Math.max(value, config.min);
      if (config.max !== undefined) value = Math.min(value, config.max);
      break;
    }

    case 'sine': {
      const time = Date.now() / 1000;
      const amplitude = ((config.max || 100) - (config.min || 0)) / 2;
      const offset = (config.min || 0) + amplitude;
      const frequency = config.frequency || 0.1;
      value = offset + amplitude * Math.sin(2 * Math.PI * frequency * time);
      break;
    }

    case 'exponential': {
      const lambda = config.lambda || 1;
      value = -Math.log(1 - Math.random()) / lambda;
      if (config.min !== undefined) value = Math.max(value, config.min);
      if (config.max !== undefined) value = Math.min(value, config.max);
      break;
    }

    default:
      value = config.min || 0;
  }

  return Number(value.toFixed(decimalPrecision || 2));
}

function generateBooleanValue(generator, config) {
  switch (generator) {
    case 'static':
      return Boolean(config.value);

    case 'probability':
      return Math.random() < (config.trueProbability || 0.5);

    case 'pattern': {
      if (!Array.isArray(config.sequence) || config.sequence.length === 0) {
        return Math.random() > 0.5;
      }
      const index = Math.floor(Date.now() / (config.intervalMs || 5000)) % config.sequence.length;
      return Boolean(config.sequence[index]);
    }

    default:
      return Math.random() > 0.5;
  }
}

function generateStringValue(generator, config) {
  switch (generator) {
    case 'static':
      return String(config.value || 'default');

    case 'list':
    case 'random': {
      if (!Array.isArray(config.values) || config.values.length === 0) {
        return 'default';
      }
      return config.values[Math.floor(Math.random() * config.values.length)];
    }

    case 'weighted': {
      if (!Array.isArray(config.weightedValues) || config.weightedValues.length === 0) {
        return 'default';
      }
      const totalWeight = config.weightedValues.reduce((sum, item) => sum + (item.weight || 1), 0);
      let random = Math.random() * totalWeight;
      for (const item of config.weightedValues) {
        random -= item.weight || 1;
        if (random <= 0) return item.value;
      }
      return config.weightedValues[0].value;
    }

    default:
      return 'default';
  }
}

function generateEnumValue(generator, config) {
  return generateStringValue(generator, config);
}

/**
 * Generate one value for a device output based on its dataType/generator/config.
 * @param {{ dataType: string, generator: string, config: object, decimalPrecision?: number }} output
 */
export function generateValue(output) {
  const { dataType, generator, config, decimalPrecision } = output;

  switch (dataType) {
    case 'number':
      return generateNumberValue(generator, config, decimalPrecision);
    case 'boolean':
      return generateBooleanValue(generator, config);
    case 'string':
      return generateStringValue(generator, config);
    case 'enum':
      return generateEnumValue(generator, config);
    default:
      return 0;
  }
}
