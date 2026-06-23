// Shared types for the simulation editor. Generator config shapes vary widely,
// so `config`/`currentValue` stay loosely typed.

export interface DeviceOutput {
  id: number;
  name: string;
  dataType: string;
  generator: string;
  unit?: string;
  decimalPrecision?: number;
  includeTimestamp?: boolean;
  config: any;
  currentValue?: any;
}

export interface SimulatedDevice {
  id: number;
  name: string;
  topic: string;
  publishInterval: number;
  isPublishing: boolean;
  outputs: DeviceOutput[];
}
