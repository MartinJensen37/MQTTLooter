import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DisplayMessage } from '../services/TopicTreeService';
import type { HistoryMessage } from '../../../shared/history';

/** Bounds for one topic's messages held in the window, whatever the Show choice. */
export const TOPIC_VIEW = {
  maxMessages: 100_000,
  maxChars: 64 * 1024 * 1024,
};

/** A message of the selected topic; disk history rows are the cursor for older messages. */
export type TopicMessage = DisplayMessage;

export interface TopicMessages {
  messages: TopicMessage[];
  /** Older messages are still being read from disk history. */
  loading: boolean;
  /** Disk history holds more messages than the window keeps. */
  capped: boolean;
  error: string;
  /** Forget everything shown, after the topic's history was cleared. */
  reset: () => void;
}

export const fromHistory = (message: HistoryMessage): TopicMessage => ({
  id: `${message.sessionId}:${message.sequence}`,
  rowId: message.rowId,
  connectionId: message.id,
  topic: message.topic,
  message: message.message,
  encoding: message.encoding,
  protocolVersion: message.protocolVersion,
  properties: message.properties,
  qos: message.qos,
  retain: message.retain,
  timestamp: message.timestamp,
  byteLength: message.byteLength,
  ...(message.truncated && { truncated: true }),
});

/** Newest first; messages of one session in the same millisecond keep receive order. */
export function newestFirst(a: TopicMessage, b: TopicMessage): number {
  if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
  const [sessionA, sequenceA] = a.id.split(':');
  const [sessionB, sequenceB] = b.id.split(':');
  return sessionA === sessionB ? Number(sequenceB) - Number(sequenceA) : 0;
}

const emptyStore = () => ({
  items: [] as TopicMessage[],
  keys: new Set<string>(),
  chars: 0,
  cursor: undefined as number | undefined,
  snapshot: undefined as number | undefined,
  generation: undefined as number | undefined,
  exhausted: false,
  capped: false,
  /** Live messages received before a clear are ignored. */
  since: 0,
});

/**
 * The selected topic's messages: the live cache at once, then older messages read from disk
 * history in the background until `shown` is reached. New live messages are added at the top
 * and the oldest drop off the end. Everything is released when the topic changes.
 */
export function useTopicMessages(
  connectionId: string | null | undefined,
  topic: string | undefined,
  live: DisplayMessage[],
  shown: number | 'all',
  active = true,
): TopicMessages {
  const limit = shown === 'all' ? TOPIC_VIEW.maxMessages : shown;
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clears, setClears] = useState({ count: 0, at: 0 });
  const store = useRef(emptyStore());

  // A new topic, or cleared history, starts over. Reset during render so stale messages
  // are never shown for the new topic.
  const view = `${connectionId}\0${topic}\0${clears.count}`;
  const [viewFor, setViewFor] = useState(view);
  if (viewFor !== view) {
    setViewFor(view);
    store.current = { ...emptyStore(), since: clears.at };
    setError('');
  }

  const trim = (state = store.current) => {
    let removed = false;
    let full = false;
    while (
      state.items.length > limit ||
      (state.items.length > 1 && state.chars > TOPIC_VIEW.maxChars)
    ) {
      full ||= state.items.length <= limit;
      const item = state.items.pop()!;
      state.keys.delete(item.id);
      state.chars -= item.message.length;
      removed = true;
    }
    if (!removed) return;
    // More history exists than the window keeps.
    state.capped ||= full || shown === 'all';
    // Resume below the oldest kept disk row if the limit is raised again.
    state.exhausted = false;
    let cursor: number | undefined;
    for (let index = state.items.length - 1; index >= 0 && cursor === undefined; index--)
      cursor = state.items[index].rowId;
    state.cursor = cursor;
  };

  const add = (incoming: TopicMessage[], position: 'top' | 'end', state = store.current) => {
    const fresh = incoming.filter((item) => !state.keys.has(item.id));
    if (!fresh.length) return;
    for (const item of fresh) {
      state.keys.add(item.id);
      state.chars += item.message.length;
    }
    const { items } = state;
    const ordered =
      !items.length ||
      (position === 'top'
        ? newestFirst(fresh.at(-1)!, items[0]) <= 0
        : newestFirst(items.at(-1)!, fresh[0]) <= 0);
    state.items = position === 'top' ? [...fresh, ...items] : items.concat(fresh);
    // Messages dropped from live delivery under load can still arrive from disk in between.
    if (!ordered) state.items.sort(newestFirst);
    trim(state);
  };

  // Live messages arrive newest first; anything not yet shown is newer than the list.
  // Adding is idempotent, so a repeated render cannot add a message twice.
  const liveVersion = useMemo(() => {
    const { since } = store.current;
    if (topic !== undefined)
      add(
        live.filter((message) => message.topic === topic && message.timestamp >= since),
        'top',
      );
    return {};
  }, [live, topic, viewFor]);

  // Lowering the limit drops the oldest messages at once.
  const limitVersion = useMemo(() => {
    trim();
    return {};
  }, [limit, viewFor]);

  useEffect(() => {
    const state = store.current;
    if (!active || !connectionId || topic === undefined) return;
    if (state.exhausted || state.capped || state.items.length >= limit) return;
    let disposed = false;
    setLoading(true);
    void (async () => {
      try {
        while (!disposed && !state.capped && state.items.length < limit) {
          const result = await window.electronAPI.history.page({
            connectionId,
            topic,
            before: state.cursor,
            snapshot: state.snapshot,
            generation: state.generation,
          });
          if (disposed) return;
          if (!result.success || !result.data)
            throw new Error(result.error ?? 'Disk history is unavailable.');
          const page = result.data;
          state.snapshot = page.snapshot;
          state.generation = page.generation;
          state.cursor = page.nextBefore ?? undefined;
          add(page.messages.map(fromHistory), 'end', state);
          setVersion((value) => value + 1);
          if (page.nextBefore === null) {
            state.exhausted = true;
            break;
          }
          // Let rendering and live delivery run between pages.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } catch (reason) {
        if (!disposed) {
          state.exhausted = true;
          setError((reason as Error).message);
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
      setLoading(false);
    };
  }, [active, connectionId, topic, limit, viewFor]);

  const { items, capped } = store.current;
  // A new array whenever the contents change, for memoized consumers.
  const messages = useMemo(() => items.slice(), [items, version, liveVersion, limitVersion]);
  const reset = useCallback(
    () => setClears((value) => ({ count: value.count + 1, at: Date.now() })),
    [],
  );
  return { messages, loading, capped, error, reset };
}
