import { useSyncExternalStore } from 'react';

/** Options that are rarely changed, edited in Tools > Advanced settings. */
export interface AdvancedSettings {
  /** Show the payload encoding choice (UTF-8, hex, base64) in Publishing. */
  payloadEncoding: boolean;
  /** Show the Decoders button in Logging. */
  protobufDecoders: boolean;
}

const KEY = 'mqtt-advanced-settings';
const DEFAULTS: AdvancedSettings = { payloadEncoding: false, protobufDecoders: false };

class AdvancedSettingsStore {
  private state: AdvancedSettings = DEFAULTS;
  private listeners = new Set<() => void>();

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      for (const key of Object.keys(DEFAULTS) as (keyof AdvancedSettings)[])
        if (typeof saved[key] === 'boolean') this.state = { ...this.state, [key]: saved[key] };
    } catch {
      /* Defaults apply when saved settings cannot be read. */
    }
  }

  snapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(patch: Partial<AdvancedSettings>): void {
    this.state = { ...this.state, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* The change still applies for this session. */
    }
    this.listeners.forEach((listener) => listener());
  }
}

export const advancedSettings = new AdvancedSettingsStore();

export function useAdvancedSettings(): AdvancedSettings {
  return useSyncExternalStore(advancedSettings.subscribe, advancedSettings.snapshot);
}
