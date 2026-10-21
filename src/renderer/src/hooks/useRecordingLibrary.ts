import { useCallback, useEffect, useRef, useState } from 'react';
import { parseRecording, type Recording } from '../../../shared/recording';
import type { IpcResult } from '../../../shared/ipc';

function unwrap<T>(result: IpcResult<T>): T {
  if (!result.success || result.data === undefined)
    throw new Error(result.error || 'Recording storage is unavailable');
  return result.data;
}

export function useRecordingLibrary() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const revision = useRef(0);
  const saved = useRef<Recording[]>([]);
  const desired = useRef<Recording[]>([]);
  const saving = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      try {
        const api = window.electronAPI?.recordings;
        if (!api) throw new Error('Recording storage is unavailable');
        const legacy = localStorage.getItem('mqtt-recordings');
        let library = unwrap(await api.load());
        if (cancelled) return;
        if (legacy !== null) {
          const data = JSON.parse(legacy);
          if (!Array.isArray(data))
            throw new Error('Invalid legacy recording library; original data has been kept');
          library = unwrap(await api.migrate(data));
        }
        // Remove the legacy copy only after the main process confirms migration.
        if (legacy !== null && library.legacyMigrated) localStorage.removeItem('mqtt-recordings');
        if (cancelled) return;
        const parsed = library.recordings.map(parseRecording);
        revision.current = library.revision;
        saved.current = desired.current = parsed;
        setRecordings(parsed);
        setReady(true);
        setStatus('saved');
        setError('');
      } catch (cause) {
        if (!cancelled) {
          setError((cause as Error).message);
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  // One write at a time; coalesce edits made while an earlier snapshot is saving.
  const flush = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      while (desired.current !== saved.current) {
        if (mounted.current) {
          setStatus('saving');
          setError('');
        }
        const snapshot = desired.current;
        revision.current = unwrap(
          await window.electronAPI.recordings.save(snapshot, revision.current),
        );
        saved.current = snapshot;
      }
      if (mounted.current) setStatus('saved');
    } catch (cause) {
      if (mounted.current) {
        setError((cause as Error).message);
        setStatus('error');
      }
    } finally {
      saving.current = false;
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    desired.current = recordings;
    if (recordings !== saved.current) void flush();
  }, [recordings, ready, flush]);

  const addRecording = useCallback((recording: Recording) => {
    setRecordings((previous) => {
      const ids = new Set(previous.map((item) => item.id));
      let id = Date.now();
      while (ids.has(id)) id++;
      return [...previous, { ...recording, id }];
    });
  }, []);

  const retry = () => {
    if (ready) void flush();
    else setLoadAttempt((value) => value + 1);
  };
  return { recordings, setRecordings, addRecording, ready, status, error, retry };
}
