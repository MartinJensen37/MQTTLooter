// Shared types for the simulation editor. Generator config shapes vary widely,
// so `config`/`currentValue` stay loosely typed.

export type SimulationPayloadMode = 'json' | 'raw';
export interface DeviceOutput {
  payloadMode?: SimulationPayloadMode;
  id: number;
  name: string;
  dataType: string;
  generator: string;
  unit?: string;
  decimalPrecision?: number;
  includeTimestamp?: boolean;
  config: any;
  currentValue?: any;
  topic?: string;
  timing?: {
    mode: 'sync' | 'fixed' | 'random';
    intervalMs?: number;
    offsetMs?: number;
    jitterPercent?: number;
    probability?: number;
  };
}

export interface SimulatedDevice {
  schemaVersion?: 1;
  payloadMode?: SimulationPayloadMode;
  id: number;
  name: string;
  topic: string;
  publishInterval: number;
  isPublishing: boolean;
  outputs: DeviceOutput[];
  qos?: 0 | 1 | 2;
  retain?: boolean;
  payloadFormat?: 'auto' | 'named';
  publishMode?: 'combined' | 'signals';
}
