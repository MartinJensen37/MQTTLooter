import { useCallback, useEffect, useRef, useState } from 'react';
import type { IpcResult } from '../../../shared/ipc';
import type { RecordingStatus, RecordingSummary } from '../../../shared/recording';

export function unwrap<T>(result: IpcResult<T>): T {
  if (!result?.success) throw new Error(result?.error || 'Recording storage is unavailable');
  return result.data as T;
}

/** Recording metadata and capture status. Messages stay in main's database until paged. */
export function useRecordingLibrary() {
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [status, setStatus] = useState<RecordingStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const api = window.electronAPI.recordings;
    const [list, next] = await Promise.all([api.list(), api.status()]);
    if (!mounted.current) return;
    setRecordings(unwrap(list));
    setStatus(unwrap(next));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError('');
    void (async () => {
      try {
        const api = window.electronAPI?.recordings;
        if (!api) throw new Error('Recording storage is unavailable');
        const legacy = localStorage.getItem('mqtt-recordings');
        if (legacy !== null) {
          const data = JSON.parse(legacy);
          if (!Array.isArray(data))
            throw new Error('Invalid legacy recording library; original data has been kept');
          unwrap(await api.migrate(data));
          // Remove the legacy copy only after main confirms the import committed.
          localStorage.removeItem('mqtt-recordings');
        }
        if (cancelled) return;
        await refresh();
        if (!cancelled) setReady(true);
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, refresh]);

  // Captures run in main; poll their counts, faster while one is active.
  const recording = Boolean(status?.active.length);
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(
      () => {
        void window.electronAPI.recordings
          .status()
          .then((result) => {
            if (mounted.current && result?.success) setStatus(result.data!);
          })
          .catch(() => {});
      },
      recording ? 500 : 2000,
    );
    return () => clearInterval(timer);
  }, [ready, recording]);

  // A capture that started or ended (including automatic stops) changes the list.
  const activeKey = status?.active.map((capture) => capture.recordingId).join(',');
  useEffect(() => {
    if (ready) void refresh().catch(() => {});
  }, [activeKey, ready, refresh]);

  const retry = () => setLoadAttempt((value) => value + 1);
  return { recordings, status, ready, error, refresh, retry };
}
