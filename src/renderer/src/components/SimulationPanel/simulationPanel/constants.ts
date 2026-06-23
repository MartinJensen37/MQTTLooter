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
    generators: ['static', 'uniform', 'normal', 'sine', 'exponential'],
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
    generators: ['static', 'list', 'weighted'],
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
  sine: { label: 'Sine Wave', fields: ['min', 'max', 'frequency'] },
  exponential: { label: 'Exponential', fields: ['lambda', 'min', 'max'] },
  probability: { label: 'Probability', fields: ['trueProbability'] },
  pattern: { label: 'Pattern Sequence', fields: ['sequence'] },
  list: { label: 'Random from List', fields: ['values'] },
  weighted: { label: 'Weighted Random', fields: ['weightedValues'] },
  random: { label: 'Random Selection', fields: ['values'] },
};
