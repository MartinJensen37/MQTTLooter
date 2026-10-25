// Data-type and generator metadata for the simulation editor.

interface DataTypeConfig {
  label: string;
  generators: string[];
  hasUnit: boolean;
  hasDecimalPrecision: boolean;
}

export const DATA_TYPE_CONFIGS: Record<string, DataTypeConfig> = {
  number: {
    label: 'Number',
    generators: [
      'static',
      'uniform',
      'normal',
      'sine',
      'square',
      'triangle',
      'sawtooth',
      'ramp',
      'step',
      'response',
      'counter',
      'walk',
      'exponential',
    ],
    hasUnit: true,
    hasDecimalPrecision: true,
  },
  boolean: {
    label: 'Boolean',
    generators: ['static', 'probability', 'pattern'],
    hasUnit: false,
    hasDecimalPrecision: false,
  },
  string: {
    label: 'String',
    generators: ['static', 'list', 'weighted', 'pattern'],
    hasUnit: false,
    hasDecimalPrecision: false,
  },
  enum: {
    label: 'Enum',
    generators: ['static', 'random', 'weighted', 'pattern'],
    hasUnit: false,
    hasDecimalPrecision: false,
  },
};

interface GeneratorConfig {
  label: string;
  fields: string[];
}

export const GENERATOR_CONFIGS: Record<string, GeneratorConfig> = {
  static: { label: 'Static Value', fields: ['value'] },
  uniform: { label: 'Uniform Random', fields: ['min', 'max'] },
  normal: { label: 'Normal Distribution', fields: ['mean', 'stdDev', 'min', 'max'] },
  sine: { label: 'Sine Wave', fields: ['min', 'max', 'frequency', 'phase'] },
  square: { label: 'Square Wave', fields: ['min', 'max', 'frequency', 'phase', 'dutyCycle'] },
  triangle: { label: 'Triangle Wave', fields: ['min', 'max', 'frequency', 'phase'] },
  sawtooth: { label: 'Sawtooth Wave', fields: ['min', 'max', 'frequency', 'phase'] },
  counter: { label: 'Counter', fields: ['start', 'step', 'min', 'max'] },
  ramp: { label: 'Ramp', fields: ['start', 'end', 'delayMs', 'durationMs'] },
  step: { label: 'Step', fields: ['start', 'end', 'delayMs'] },
  response: { label: 'Step Response', fields: ['start', 'end', 'delayMs', 'timeConstantMs'] },
  walk: { label: 'Random Walk', fields: ['start', 'step', 'min', 'max'] },
  exponential: { label: 'Exponential', fields: ['lambda', 'min', 'max'] },
  probability: { label: 'Probability', fields: ['trueProbability'] },
  pattern: { label: 'Pattern Sequence', fields: ['sequence', 'intervalMs'] },
  list: { label: 'Random from List', fields: ['values'] },
  weighted: { label: 'Weighted Random', fields: ['weightedValues'] },
  random: { label: 'Random Selection', fields: ['values'] },
};
