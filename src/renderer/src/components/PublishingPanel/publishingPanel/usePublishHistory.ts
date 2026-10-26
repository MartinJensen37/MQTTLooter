import { useEffect, useState } from 'react';
import type { PublishHistoryItem } from './types';

const LIMIT = 10;
const storageKey = (connectionId: string) => `publish-history-${connectionId}`;

function load(connectionId: string | null | undefined): PublishHistoryItem[] {
  if (!connectionId) return [];
  try {
    const history = JSON.parse(localStorage.getItem(storageKey(connectionId)) || '[]');
    return Array.isArray(history)
      ? history
          .filter(
            (item) => item && typeof item.topic === 'string' && typeof item.payload === 'string',
          )
          .slice(0, LIMIT)
      : [];
  } catch {
    return [];
  }
}

const sameMessage = (a: PublishHistoryItem, b: PublishHistoryItem) =>
  a.topic === b.topic &&
  a.payload === b.payload &&
  (a.encoding ?? 'utf8') === (b.encoding ?? 'utf8') &&
  a.qos === b.qos &&
  a.retain === b.retain &&
  JSON.stringify(a.properties ?? {}) === JSON.stringify(b.properties ?? {});

/** The last ten distinct messages published on a connection, newest first, saved locally. */
export function usePublishHistory(
  connectionId: string | null | undefined,
  showFeedback?: (message: string, type?: string) => void,
) {
  const [history, setHistory] = useState(() => load(connectionId));

  useEffect(() => {
    if (!connectionId) return;
    try {
      localStorage.setItem(storageKey(connectionId), JSON.stringify(history));
    } catch {
      showFeedback?.('Publish history could not be saved locally.', 'error');
    }
  }, [history, connectionId, showFeedback]);

  /** Adds a published message; publishing the same message again moves it to the top. */
  const record = (message: PublishHistoryItem) =>
    setHistory((previous) => {
      const existing = previous.find((item) => sameMessage(item, message));
      const rest = previous.filter((item) => item !== existing);
      return [existing ? { ...existing, timestamp: message.timestamp } : message, ...rest].slice(
        0,
        LIMIT,
      );
    });

  const clear = () => {
    setHistory([]);
    if (connectionId) localStorage.removeItem(storageKey(connectionId));
  };

  return { history, record, clear };
}
