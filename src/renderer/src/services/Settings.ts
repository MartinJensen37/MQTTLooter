import { useSyncExternalStore } from 'react';

/** User preferences, edited in Tools > Settings. */
export interface Settings {
  /** Default View for message cards. */
  payloadView: 'auto' | 'text' | 'hex';
  timeFormat: 'system' | '24h' | '12h';
  theme: 'system' | 'light' | 'dark';
  /** Interface zoom in percent. */
  textSize: number;
  uiFont: 'system' | 'segoe' | 'arial' | 'verdana';
  codeFont: 'system' | 'consolas' | 'cascadia' | 'courier';
  /** Show the payload encoding choice (UTF-8 or base64) in Publishing. */
  payloadEncoding: boolean;
  /** Show the Decoders button in Logging. */
  protobufDecoders: boolean;
  /** Sparkplug B decoding and tools for spBv1.0 topics. */
  sparkplug: boolean;
}

export const SETTING_CHOICES = {
  payloadView: ['auto', 'text', 'hex'],
  timeFormat: ['system', '24h', '12h'],
  theme: ['system', 'light', 'dark'],
  textSize: [90, 100, 110, 125],
  uiFont: ['system', 'segoe', 'arial', 'verdana'],
  codeFont: ['system', 'consolas', 'cascadia', 'courier'],
  payloadEncoding: [false, true],
  protobufDecoders: [false, true],
  sparkplug: [false, true],
} as const satisfies { [K in keyof Settings]: readonly Settings[K][] };

const DEFAULTS: Settings = {
  payloadView: 'auto',
  timeFormat: 'system',
  theme: 'system',
  textSize: 100,
  uiFont: 'system',
  codeFont: 'system',
  payloadEncoding: false,
  protobufDecoders: false,
  sparkplug: false,
};
const KEY = 'mqtt-settings';
/** Saved by earlier versions as "Advanced settings". */
const LEGACY_KEY = 'mqtt-advanced-settings';

class SettingsStore {
  private state: Settings = DEFAULTS;
  private listeners = new Set<() => void>();

  constructor() {
    try {
      const saved = {
        ...JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '{}'),
        ...JSON.parse(localStorage.getItem(KEY) ?? '{}'),
      };
      for (const key of Object.keys(DEFAULTS) as (keyof Settings)[])
        if ((SETTING_CHOICES[key] as readonly unknown[]).includes(saved[key]))
          this.state = { ...this.state, [key]: saved[key] };
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

  set(patch: Partial<Settings>): void {
    const next = { ...this.state };
    for (const [key, value] of Object.entries(patch) as [keyof Settings, unknown][])
      if ((SETTING_CHOICES[key] as readonly unknown[]).includes(value))
        (next as Record<string, unknown>)[key] = value;
    this.state = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* The change still applies for this session. */
    }
    this.listeners.forEach((listener) => listener());
  }
}

export const settings = new SettingsStore();

export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, settings.snapshot);
}
