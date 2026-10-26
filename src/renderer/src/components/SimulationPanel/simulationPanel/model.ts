import { expandTemplate } from '../../../../../shared/template-expansion';
import { DATA_TYPE_CONFIGS } from './constants';
import type { DeviceOutput, SimulatedDevice } from './types';
import { validatePublishTopic } from '../../../../../shared/publish-properties';

export const payloadMode = (device?: SimulatedDevice, output?: DeviceOutput) =>
  (!device || device.publishMode === 'signals' ? output?.payloadMode : undefined) ??
  device?.payloadMode ??
  'json';

export const signalTopic = (device: SimulatedDevice, output: DeviceOutput) =>
  typeof output.topic === 'string' && output.topic !== ''
    ? output.topic
    : `${device.topic}/${output.name.trim()}`;
export const validTopic = (topic: string) => {
  try {
    validatePublishTopic(topic);
    return true;
  } catch {
    return false;
  }
};

export function validateTiming(output: DeviceOutput): string[] {
  const t = output.timing;
  if (!t) return [];
  const errors: string[] = [];
  if (!['sync', 'fixed', 'random'].includes(t.mode)) errors.push('Choose a supported timing mode.');
  if (
    t.mode !== 'sync' &&
    (!Number.isFinite(t.intervalMs) || t.intervalMs! < 100 || t.intervalMs! > 86400000)
  )
    errors.push('Signal period must be between 100 and 86,400,000 ms.');
  if (!Number.isFinite(t.offsetMs ?? 0) || (t.offsetMs ?? 0) < 0 || (t.offsetMs ?? 0) > 86400000)
    errors.push('Offset must be between 0 and 86,400,000 ms.');
  if (!Number.isFinite(t.probability ?? 1) || (t.probability ?? 1) < 0 || (t.probability ?? 1) > 1)
    errors.push('Publish probability must be between 0 and 1.');
  if (
    !Number.isFinite(t.jitterPercent ?? 20) ||
    (t.jitterPercent ?? 20) < 0 ||
    (t.jitterPercent ?? 20) > 100
  )
    errors.push('Interval variation must be between 0 and 100%.');
  return errors;
}

export function defaultConfig(type: string, generator: string): Record<string, any> {
  switch (generator) {
    case 'static':
      return { value: type === 'number' ? 50 : type === 'boolean' ? true : 'online' };
    case 'uniform':
      return { min: 0, max: 100 };
    case 'normal':
      return { mean: 50, stdDev: 10, min: 0, max: 100 };
    case 'sine':
    case 'square':
    case 'triangle':
    case 'sawtooth':
      return {
        min: 0,
        max: 100,
        frequency: 0.1,
        phase: 0,
        ...(generator === 'square' ? { dutyCycle: 0.5 } : {}),
      };
    case 'counter':
    case 'walk':
      return { start: 0, step: 1, min: 0, max: 100 };
    case 'ramp':
      return { start: 0, end: 100, delayMs: 0, durationMs: 5000 };
    case 'step':
      return { start: 0, end: 100, delayMs: 1000 };
    case 'response':
      return { start: 0, end: 100, delayMs: 1000, timeConstantMs: 1000 };
    case 'exponential':
      return { lambda: 1, min: 0, max: 100 };
    case 'probability':
      return { trueProbability: 0.5 };
    case 'pattern':
      return {
        sequence: type === 'boolean' ? [true, false] : ['idle', 'running', 'idle'],
        intervalMs: 1000,
      };
    case 'weighted':
      return {
        weightedValues: [
          { value: 'online', weight: 9 },
          { value: 'offline', weight: 1 },
        ],
      };
    default:
      return { values: ['online', 'offline'] };
  }
}

export function validateOutput(output: DeviceOutput, others: DeviceOutput[] = []): string[] {
  const errors: string[] = validateTiming(output);
  if (!['json', 'raw'].includes(output.payloadMode ?? 'json'))
    errors.push('Invalid signal payload mode.');
  if (
    output.topic !== undefined &&
    (typeof output.topic !== 'string' || (output.topic !== '' && !validTopic(output.topic)))
  )
    errors.push('Use a publish topic without wildcards or NUL.');
  if (!output.name?.trim()) errors.push('Signal name is required.');
  if (others.some((other) => other.id !== output.id && other.name.trim() === output.name.trim()))
    errors.push('Signal names must be unique within a device.');
  if (!DATA_TYPE_CONFIGS[output.dataType]?.generators.includes(output.generator))
    errors.push('Choose a supported signal type and generator.');
  const c = { ...defaultConfig(output.dataType, output.generator), ...output.config };
  const number = (key: string, minimum = -Infinity, maximum = Infinity) => {
    if (
      typeof c[key] !== 'number' ||
      !Number.isFinite(c[key]) ||
      c[key] < minimum ||
      c[key] > maximum
    ) {
      const range =
        Number.isFinite(minimum) && Number.isFinite(maximum)
          ? ` between ${minimum} and ${maximum}`
          : Number.isFinite(minimum)
            ? ` greater than or equal to ${minimum}`
            : Number.isFinite(maximum)
              ? ` less than or equal to ${maximum}`
              : '';
      errors.push(`${key} must be a finite number${range}.`);
    }
  };
  if (output.dataType === 'number') {
    if (
      !Number.isInteger(output.decimalPrecision ?? 2) ||
      (output.decimalPrecision ?? 2) < 0 ||
      (output.decimalPrecision ?? 2) > 10
    )
      errors.push('Decimal places must be between 0 and 10.');
    if (output.generator === 'static') number('value');
    else if (['ramp', 'step', 'response'].includes(output.generator)) {
      number('start');
      number('end');
      number('delayMs', 0, 86400000);
      if (output.generator === 'ramp') number('durationMs', 1, 86400000);
      if (output.generator === 'response') number('timeConstantMs', 1, 86400000);
    } else {
      number('min');
      number('max');
      if (c.min > c.max) errors.push('Minimum must not exceed maximum.');
    }
    if (output.generator === 'normal') {
      number('mean');
      number('stdDev', 0);
    }
    if (['sine', 'square', 'triangle', 'sawtooth'].includes(output.generator)) {
      number('frequency', 0);
      number('phase');
    }
    if (output.generator === 'square') number('dutyCycle', 0, 1);
    if (['counter', 'walk'].includes(output.generator)) {
      number('start', c.min, c.max);
      number('step', output.generator === 'walk' ? 0 : -Infinity);
    }
    if (output.generator === 'exponential') {
      number('lambda', Number.MIN_VALUE);
    }
  }
  if (
    output.generator === 'static' &&
    output.dataType !== 'number' &&
    typeof c.value !== (output.dataType === 'boolean' ? 'boolean' : 'string')
  )
    errors.push('Static value has the wrong data type.');
  if (output.generator === 'probability') number('trueProbability', 0, 1);
  if (output.generator === 'pattern') {
    number('intervalMs', 1, 86400000);
    if (
      !Array.isArray(c.sequence) ||
      !c.sequence.length ||
      c.sequence.some(
        (v: unknown) => typeof v !== (output.dataType === 'boolean' ? 'boolean' : 'string'),
      )
    )
      errors.push('Add at least one valid sequence step.');
  }
  if (
    ['list', 'random'].includes(output.generator) &&
    (!Array.isArray(c.values) ||
      !c.values.length ||
      c.values.some((v: unknown) => typeof v !== 'string'))
  )
    errors.push('Add at least one string value.');
  if (
    output.generator === 'weighted' &&
    (!Array.isArray(c.weightedValues) ||
      !c.weightedValues.length ||
      c.weightedValues.some(
        (v: any) => !v || typeof v.value !== 'string' || !Number.isFinite(v.weight) || v.weight < 0,
      ) ||
      !Number.isFinite(c.weightedValues.reduce((sum: number, v: any) => sum + v.weight, 0)) ||
      c.weightedValues.every((v: any) => v.weight === 0))
  )
    errors.push('Weights must be nonnegative, with at least one positive weight.');
  return errors;
}

export function validateDevice(device: SimulatedDevice): string[] {
  const errors: string[] = [];
  if (!['json', 'raw'].includes(device.payloadMode ?? 'json'))
    errors.push('Invalid device payload mode.');
  const template = device.publishMode !== 'signals' && device.payloadFormat === 'template';
  if (
    device.publishMode !== 'signals' &&
    device.payloadMode === 'raw' &&
    !template &&
    device.outputs.length !== 1
  )
    errors.push(
      'Combined raw output requires exactly one signal. Use one topic per signal for multiple raw values.',
    );
  if (!device.name.trim()) errors.push('Device name is required.');
  if (!validTopic(device.topic))
    errors.push('Use a nonempty publish topic without wildcards or NUL.');
  if (
    !Number.isFinite(device.publishInterval) ||
    device.publishInterval < 100 ||
    device.publishInterval > 86400000
  )
    errors.push('Publish interval must be between 100 and 86,400,000 ms.');
  if (![0, 1, 2].includes(device.qos ?? 0)) errors.push('QoS must be 0, 1 or 2.');
  if (device.retain !== undefined && typeof device.retain !== 'boolean')
    errors.push('Retain must be true or false.');
  if (!['auto', 'named', 'template'].includes(device.payloadFormat ?? 'auto'))
    errors.push('Invalid payload format.');
  if (template) errors.push(...validatePayloadTemplate(device));
  if (!['combined', 'signals'].includes(device.publishMode ?? 'combined'))
    errors.push('Invalid publishing mode.');
  if (device.publishMode === 'signals')
    for (const output of device.outputs)
      if (!validTopic(signalTopic(device, output)))
        errors.push(`${output.name}: Invalid resolved topic.`);
  if (device.sparkplug) {
    const { group, edgeNode, device: child } = device.sparkplug;
    const id = (value: unknown) =>
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 256 &&
      !/[/+#\0]/.test(value);
    if (!id(group) || !id(edgeNode) || (child && !id(child)))
      errors.push('Sparkplug group, edge node and device IDs need text without /, + or #.');
    if (device.publishMode === 'signals')
      errors.push('Sparkplug devices publish all signals in one message.');
  }
  if (!device.outputs.length) errors.push('Add at least one signal.');
  for (const output of device.outputs)
    errors.push(
      ...validateOutput(output, device.outputs).map((error) => `${output.name}: ${error}`),
    );
  return errors;
}

export const MAX_PAYLOAD_TEMPLATE = 64 * 1024;

/** Check syntax and placeholder names with stand-in values, without publishing anything. */
export function validatePayloadTemplate(device: SimulatedDevice): string[] {
  const template = device.payloadTemplate ?? '';
  if (!template.trim()) return ['Enter a payload template.'];
  if (template.length > MAX_PAYLOAD_TEMPLATE) return ['Payload template exceeds 64 KiB.'];
  if ((device.payloadMode ?? 'json') === 'json') {
    try {
      JSON.parse(template);
    } catch {
      return ['JSON templates must be valid JSON. Put placeholders inside strings: "{{name}}".'];
    }
  }
  try {
    expandTemplate(
      { topic: '', payload: template },
      Object.fromEntries(device.outputs.map((output) => [output.name.trim(), 0])),
      { uuid: () => '00000000-0000-4000-8000-000000000000' },
    );
  } catch (error) {
    return [(error as Error).message];
  }
  return [];
}

/** A starting template naming every signal, in the device's payload mode. */
export function defaultPayloadTemplate(device: SimulatedDevice): string {
  if (device.payloadMode === 'raw')
    return device.outputs
      .map((output) => `${output.name.trim()}={{${output.name.trim()}}}`)
      .join(';');
  return JSON.stringify(
    {
      device: device.name,
      timestamp: '{{isoTimestamp}}',
      values: Object.fromEntries(
        device.outputs.map((output) => [output.name.trim(), `{{${output.name.trim()}}}`]),
      ),
    },
    null,
    2,
  );
}

export function nextId(items: { id: number }[]): number {
  let id = Date.now();
  while (items.some((item) => item.id === id)) id++;
  return id;
}

export function loadDevices(raw: string | null): SimulatedDevice[] {
  const devices = JSON.parse(raw ?? '[]');
  if (!Array.isArray(devices)) throw new Error('Saved devices must be a list.');
  const ids = new Set<number>();
  return devices.map((device) => {
    if (device?.schemaVersion !== undefined && device.schemaVersion !== 1)
      throw new Error('Unsupported saved device schema version.');
    if (
      !device ||
      typeof device.name !== 'string' ||
      typeof device.topic !== 'string' ||
      !Number.isSafeInteger(device.id) ||
      ids.has(device.id) ||
      !Array.isArray(device.outputs)
    )
      throw new Error('Invalid saved device.');
    ids.add(device.id);
    if (!['json', 'raw'].includes(device.payloadMode ?? 'json'))
      throw new Error('Invalid saved payload mode.');
    const outputIds = new Set<number>();
    for (const output of device.outputs) {
      if (
        !output ||
        typeof output.name !== 'string' ||
        !Number.isSafeInteger(output.id) ||
        outputIds.has(output.id) ||
        !DATA_TYPE_CONFIGS[output.dataType]?.generators.includes(output.generator) ||
        !output.config ||
        typeof output.config !== 'object' ||
        Array.isArray(output.config)
      )
        throw new Error('Invalid saved signal.');
      outputIds.add(output.id);
      if (!['json', 'raw'].includes(output.payloadMode ?? 'json'))
        throw new Error('Invalid saved signal payload mode.');
    }
    return {
      ...device,
      schemaVersion: 1,
      payloadMode: device.payloadMode ?? 'json',
      isPublishing: false,
      qos: device.qos ?? 0,
      retain: device.retain ?? false,
      payloadFormat: device.payloadFormat ?? 'auto',
      publishMode: device.publishMode ?? 'combined',
      outputs: device.outputs.map((output: DeviceOutput) => ({
        ...output,
        currentValue: undefined,
      })),
    };
  });
}

export const PRESETS = {
  sensor: 'Temperature sensor',
  environment: 'Room environment',
  machine: 'Machine telemetry',
  blank: 'Custom device',
};
export function presetOutputs(preset: string): DeviceOutput[] {
  const signal = (
    id: number,
    name: string,
    dataType: string,
    generator: string,
    config: any,
    unit = '',
  ): DeviceOutput => ({
    id,
    name,
    dataType,
    generator,
    config,
    unit,
    decimalPrecision: 2,
    includeTimestamp: true,
  });
  const temperature = signal(
    1,
    'temperature',
    'number',
    'normal',
    { mean: 21.5, stdDev: 1.5, min: 18, max: 25 },
    '\u00b0C',
  );
  if (preset === 'environment')
    return [
      temperature,
      signal(2, 'humidity', 'number', 'sine', { min: 30, max: 70, frequency: 0.01 }, '%'),
      signal(3, 'occupied', 'boolean', 'pattern', { sequence: [true, false], intervalMs: 10000 }),
    ];
  if (preset === 'machine')
    return [
      signal(1, 'speed', 'number', 'triangle', { min: 0, max: 1500, frequency: 0.1 }, 'rpm'),
      signal(2, 'cycles', 'number', 'counter', { start: 0, step: 1, min: 0, max: 1000000 }),
      signal(3, 'state', 'enum', 'pattern', {
        sequence: ['idle', 'running', 'cooling'],
        intervalMs: 5000,
      }),
    ];
  return preset === 'blank'
    ? [signal(1, 'value', 'number', 'static', { value: 0 })]
    : [temperature];
}
