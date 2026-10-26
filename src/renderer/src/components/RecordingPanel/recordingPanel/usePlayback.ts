import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { unwrap } from '../../../hooks/useRecordingLibrary';
import { RecordingCursor } from '../../../services/RecordingCursor';
import type { PlaybackState, StoredRecordingMessage } from './types';

const api = () => window.electronAPI.recordings;

/**
 * Plays one saved recording, optionally limited to some topics. Messages are read through a
 * cursor over main's database, so a recording of any size plays without loading it whole.
 * `publish` sends each played message; changing `stopKey` stops playback.
 */
export function usePlayback({
  recordingId,
  topics,
  publish,
  showFeedback,
  stopKey,
}: {
  recordingId: number | null;
  topics: string[];
  publish: (message: StoredRecordingMessage) => Promise<void>;
  showFeedback?: (message: string, type?: string) => void;
  stopKey: unknown;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const cursorRef = useRef<RecordingCursor | null>(null);
  const [cursorVersion, setCursorVersion] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentMessage, setCurrentMessage] = useState<StoredRecordingMessage | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  // Wall-clock origin for the current play run, so publish latency does not accumulate.
  const anchor = useRef<{ wall: number; time: number; speed: number } | null>(null);
  const [stepSize, setStepSize] = useState(1);
  // Bumped by every control, so a slow step that was overtaken does not move the position.
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
    setIsPlaying(false);
    setIsPaused(false);
  }, [stopKey]);

  // A new cursor and filtered total whenever the recording or topic filter changes.
  const filterKey = JSON.stringify(topics);
  useEffect(() => {
    generation.current++;
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentIndex(0);
    setCurrentMessage(null);
    if (recordingId === null) {
      cursorRef.current = null;
      setPlayback(null);
      return;
    }
    const selected: string[] = JSON.parse(filterKey);
    const filter = selected.length ? selected : undefined;
    cursorRef.current = new RecordingCursor(async (query) =>
      unwrap(await api().page({ recordingId, ...query, topics: filter })),
    );
    setCursorVersion((value) => value + 1);
    let cancelled = false;
    void (async () => {
      try {
        const [topicList, total, list] = await Promise.all([
          api().topics(recordingId),
          api().count(recordingId, filter),
          api().list(),
        ]);
        const recording = unwrap(list).find((item) => item.id === recordingId);
        if (cancelled || !recording) return;
        const { topics: available, total: topicTotal } = unwrap(topicList);
        setPlayback({
          recording,
          topics: available.map((item) => item.topic),
          topicTotal,
          total: unwrap(total),
        });
      } catch (error) {
        if (!cancelled)
          showFeedback?.(`Recording could not be loaded: ${(error as Error).message}`, 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordingId, filterKey, showFeedback]);

  // The message last played or stepped over.
  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor || currentIndex === 0) {
      setCurrentMessage(null);
      return;
    }
    let cancelled = false;
    void cursor
      .at(currentIndex - 1)
      .then((message) => {
        if (!cancelled) setCurrentMessage(message ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentIndex, cursorVersion]);

  // Only one timer is live. Publishing is never performed inside a React state updater.
  useEffect(() => {
    const cursor = cursorRef.current;
    if (!isPlaying || !cursor) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error?: Error) => {
      if (cancelled) return;
      setIsPlaying(false);
      if (error) showFeedback?.(`Playback publish failed: ${error.message}`, 'error');
      else setIsPaused(false);
    };
    void (async () => {
      const message = await cursor.at(currentIndex);
      const previous = currentIndex > 0 ? await cursor.at(currentIndex - 1) : undefined;
      if (cancelled) return;
      if (!message) return stop();
      if (!anchor.current || anchor.current.speed !== playbackSpeed)
        anchor.current = {
          wall: Date.now(),
          time: previous?.timestamp ?? message.timestamp,
          speed: playbackSpeed,
        };
      // A late or slow publish shortens the next wait instead of delaying every later message.
      const delay = Math.max(
        0,
        anchor.current.wall +
          (message.timestamp - anchor.current.time) / playbackSpeed -
          Date.now(),
      );
      timer = setTimeout(
        async () => {
          try {
            await publish(message);
            if (!cancelled) setCurrentIndex(currentIndex + 1);
          } catch (error) {
            stop(error as Error);
          }
        },
        Math.min(delay, 2_147_483_647),
      );
    })().catch((error: Error) => {
      if (!cancelled) {
        setIsPlaying(false);
        showFeedback?.(`Playback failed: ${error.message}`, 'error');
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isPlaying, cursorVersion, currentIndex, playbackSpeed, publish, showFeedback]);

  const reset = () => {
    generation.current++;
    setCurrentIndex(0);
    setIsPlaying(false);
    setIsPaused(false);
  };

  const start = () => {
    if (!playback?.total) return;
    anchor.current = null;
    if (currentIndex >= playback.total) setCurrentIndex(0);
    setIsPlaying(true);
    setIsPaused(false);
  };

  const pause = () => {
    generation.current++;
    setIsPlaying(false);
    setIsPaused(true);
  };

  const stepForward = async (event?: MouseEvent) => {
    event?.preventDefault();
    setIsPlaying(false);
    const cursor = cursorRef.current;
    if (!cursor || !playback) return;
    const run = ++generation.current;
    const nextIndex = Math.min(currentIndex + stepSize, playback.total);
    try {
      let index = currentIndex;
      for (; index < nextIndex; index++) {
        const message = await cursor.at(index);
        if (generation.current !== run || !message) break;
        await publish(message);
      }
      if (generation.current === run) setCurrentIndex(index);
    } catch (error) {
      showFeedback?.(`Playback publish failed: ${(error as Error).message}`, 'error');
    }
  };

  const stepBackward = (event?: MouseEvent) => {
    generation.current++;
    event?.preventDefault();
    setIsPlaying(false);
    setCurrentIndex(Math.max(currentIndex - stepSize, 0));
  };

  return {
    playback,
    isPlaying,
    isPaused,
    currentIndex,
    currentMessage,
    playbackSpeed,
    setPlaybackSpeed,
    stepSize,
    setStepSize,
    start,
    pause,
    reset,
    stepForward,
    stepBackward,
  };
}
