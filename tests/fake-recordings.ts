import { vi } from 'vitest';
import {
  parseRecording,
  RECORDING_LIMITS,
  type RecordingNotice,
  type RecordingPageQuery,
  type RecordingSummary,
  type StoredRecordingMessage,
} from '../src/shared/recording';

interface Stored {
  summary: RecordingSummary;
  messages: StoredRecordingMessage[];
}

/** In-memory window.electronAPI.recordings with main's capture simulated (jsdom cannot load SQLite). */
export function fakeRecordingApi() {
  const stored = new Map<number, Stored>();
  const active = new Map<string, number>();
  const notices: RecordingNotice[] = [];
  const migrated = new Set<string>();
  let nextId = 0;
  const result = async <T>(action: () => T) => {
    try {
      return { success: true, data: structuredClone(action()) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  };
  const get = (id: number) => {
    const recording = stored.get(id);
    if (!recording) throw new Error('Recording not found');
    return recording;
  };
  const topics = (recording: Stored) => [...new Set(recording.messages.map((m) => m.topic))].sort();
  const summary = (recording: Stored): RecordingSummary => {
    const list = topics(recording);
    return {
      ...recording.summary,
      messageCount: recording.messages.length,
      topicCount: list.length,
      topic: list.length === 1 ? list[0] : `${list.length} Topics`,
    };
  };
  const create = (connectionId: string | null, connectionName: string, name: string) => {
    const id = ++nextId;
    const recording: Stored = {
      summary: {
        id,
        name,
        connectionId,
        connectionName,
        state: connectionId ? 'active' : 'complete',
        startTime: Date.now(),
        endTime: connectionId ? null : Date.now(),
        messageCount: 0,
        payloadBytes: 0,
        topicCount: 0,
        topic: '0 Topics',
        dropped: 0,
        outages: 0,
      },
      messages: [],
    };
    stored.set(id, recording);
    return recording;
  };
  const finish = (connectionId: string, reason?: string) => {
    const id = active.get(connectionId);
    active.delete(connectionId);
    if (!id) return null;
    const recording = get(id);
    Object.assign(recording.summary, {
      state: 'complete',
      endTime: Date.now(),
      ...(reason && { incompleteReason: reason }),
    });
    return summary(recording);
  };
  const store = (data: unknown) => {
    const parsed = parseRecording(data);
    const recording = create(null, parsed.connectionName, parsed.name);
    recording.messages = parsed.messages.map((message, index) => ({
      ...message,
      seq: index + 1,
      timestamp: new Date(message.timestamp).getTime(),
      encoding: message.encoding ?? 'utf8',
      qos: message.qos ?? 0,
      retain: message.retain ?? false,
    }));
    return summary(recording);
  };
  const api = {
    status: vi.fn(() =>
      result(() => ({
        active: [...active].map(([connectionId, recordingId]) => {
          const recording = get(recordingId);
          return {
            recordingId,
            connectionId,
            startTime: recording.summary.startTime,
            messageCount: recording.messages.length,
            topicCount: topics(recording).length,
            dropped: 0,
          };
        }),
        queuedMessages: 0,
        notices,
        databaseBytes: 4096,
        maxDatabaseBytes: RECORDING_LIMITS.maxDatabaseBytes,
      })),
    ),
    start: vi.fn((connectionId: string, connectionName: string, name: string) =>
      result(() => {
        const recording = create(connectionId, connectionName, name);
        active.set(connectionId, recording.summary.id);
        return summary(recording);
      }),
    ),
    stop: vi.fn((connectionId: string) => result(() => finish(connectionId))),
    list: vi.fn(() => result(() => [...stored.values()].reverse().map(summary))),
    topics: vi.fn((id: number) =>
      result(() => {
        const recording = get(id);
        const list = topics(recording);
        return {
          topics: list.map((topic) => ({
            topic,
            messages: recording.messages.filter((m) => m.topic === topic).length,
          })),
          total: list.length,
        };
      }),
    ),
    gaps: vi.fn(() => result(() => [])),
    count: vi.fn((id: number, filter?: string[]) =>
      result(
        () =>
          get(id).messages.filter((message) => !filter || filter.includes(message.topic)).length,
      ),
    ),
    page: vi.fn((query: RecordingPageQuery) =>
      result(() => {
        const matching = get(query.recordingId).messages.filter(
          (message) => !query.topics || query.topics.includes(message.topic),
        );
        if (query.before !== undefined) {
          const earlier = matching.filter((message) => message.seq < query.before!);
          const messages = earlier.slice(-query.limit);
          return { messages, cursor: earlier.length > query.limit ? messages[0].seq : null };
        }
        const later = matching.filter((message) => message.seq > (query.after ?? 0));
        const messages = later.slice(0, query.limit);
        return { messages, cursor: later.length > query.limit ? messages.at(-1)!.seq : null };
      }),
    ),
    rename: vi.fn((id: number, name: string) =>
      result(() => {
        get(id).summary.name = name;
        return summary(get(id));
      }),
    ),
    delete: vi.fn((id: number) => result(() => void stored.delete(id))),
    import: vi.fn((recording: unknown) => result(() => store(recording))),
    migrate: vi.fn((recordings: unknown[]) =>
      result(() => {
        const key = JSON.stringify(recordings);
        if (migrated.has(key)) return { imported: 0, skipped: true };
        recordings.forEach(store);
        migrated.add(key);
        return { imported: recordings.length, skipped: false };
      }),
    ),
    export: vi.fn(async () => ({ success: true, data: { saved: false } })),
  };
  return {
    api,
    list: () => [...stored.values()].map(summary),
    import: store,
    /** Simulate main capturing messages for a connection's active recording. */
    capture(connectionId: string, messages: { topic: string; message: string }[]) {
      const recording = get(active.get(connectionId)!);
      for (const message of messages)
        recording.messages.push({
          ...message,
          seq: recording.messages.length + 1,
          encoding: 'utf8',
          timestamp: Date.now(),
          qos: 0,
          retain: false,
        });
    },
    stopWithNotice(connectionId: string, reason: string) {
      const recordingId = active.get(connectionId)!;
      finish(connectionId, reason);
      notices.push({ id: notices.length + 1, recordingId, connectionId, reason });
    },
  };
}
