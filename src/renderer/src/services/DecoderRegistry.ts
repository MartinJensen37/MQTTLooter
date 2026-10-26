import { useMemo, useSyncExternalStore } from 'react';
import { matchDecoder, type DecoderDefinition } from '../../../shared/decoders';
import type { PayloadEncoding } from '../../../shared/payload';
import { SPARKPLUG_DECODER, SPARKPLUG_DECODER_ID } from '../../../shared/sparkplug';
import { useSettings } from './Settings';

interface State {
  decoders: DecoderDefinition[];
  errors: Record<string, string>;
}

const MAX_CACHED = 256;
const MAX_CACHED_MESSAGE = 16 * 1024;
const CONCURRENCY = 4;

/** Saved decoders and cached decode results. Decoding itself runs in main. */
class DecoderRegistry {
  private state: State = { decoders: [], errors: {} };
  private loaded = false;
  private listeners = new Set<() => void>();
  private cache = new Map<string, Promise<string>>();
  private active = 0;
  private waiting: (() => void)[] = [];

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.loaded) void this.refresh();
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = () => this.state;

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  async refresh(): Promise<void> {
    this.loaded = true;
    const result = await window.electronAPI?.decoders?.list();
    if (!result?.success || !result.data) return;
    this.state = result.data;
    this.emit();
  }

  async save(decoders: DecoderDefinition[]): Promise<void> {
    const result = await window.electronAPI.decoders.save(decoders);
    if (!result.success || !result.data) throw new Error(result.error || 'Decoders were not saved');
    this.cache.clear();
    this.state = { decoders: result.data, errors: {} };
    this.emit();
  }

  match(topic: string): DecoderDefinition | undefined {
    return matchDecoder(this.state.decoders, topic);
  }

  /** `topic` lets Sparkplug B name aliased metrics from its edge node's births. */
  decode(
    decoder: DecoderDefinition,
    message: string,
    encoding: PayloadEncoding,
    topic?: string,
  ): Promise<string> {
    const sparkplug = decoder.id === SPARKPLUG_DECODER_ID;
    const key = `${decoder.id}\u0000${encoding}\u0000${sparkplug ? topic : ''}\u0000${message}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = this.limited(async () => {
      const response = await window.electronAPI.decoders.decode(
        decoder.id,
        message,
        encoding,
        ...(sparkplug && topic !== undefined ? [topic] : []),
      );
      if (!response.success || response.data === undefined)
        throw new Error(response.error || 'Decoding failed');
      return response.data;
    });
    if (message.length <= MAX_CACHED_MESSAGE) {
      this.cache.set(key, result);
      // Metrics named only by alias get their names once a birth arrives, so decode again.
      result.then(
        (text) => sparkplug && /"Alias [^"]*": \{/.test(text) && this.cache.delete(key),
        () => this.cache.delete(key),
      );
      if (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    }
    return result;
  }

  /** A finished request hands its slot straight to the next waiter. */
  private async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= CONCURRENCY)
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

export const decoderRegistry = new DecoderRegistry();

export function useDecoders(): State {
  return useSyncExternalStore(decoderRegistry.subscribe, decoderRegistry.snapshot);
}

/** What topics are matched against: saved decoders, then Sparkplug B when Settings turns it on. */
export function useTopicDecoders(): DecoderDefinition[] {
  const { decoders } = useDecoders();
  const { sparkplug } = useSettings();
  return useMemo(
    () => (sparkplug ? [...decoders, SPARKPLUG_DECODER] : decoders),
    [decoders, sparkplug],
  );
}
