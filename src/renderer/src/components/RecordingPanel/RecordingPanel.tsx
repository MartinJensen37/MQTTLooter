import React, { useState, useEffect, useRef, useCallback } from 'react';
import './RecordingPanel.css';
import { useRecordingLibrary, unwrap } from '../../hooks/useRecordingLibrary';
import { RecordingCursor } from '../../services/RecordingCursor';
import type {
  PlaybackState,
  RecordingSummary,
  StoredRecordingMessage,
} from './recordingPanel/types';
import { formatBytes } from './recordingPanel/recordingHelpers';
import RecordingControls from './recordingPanel/RecordingControls';
import RecordingItem from './recordingPanel/RecordingItem';
import PlaybackControls from './recordingPanel/PlaybackControls';
import CheckToggle from '../Controls/CheckToggle';
import { dateTime } from '../../utils/time';

interface RecordingPanelProps {
  connectionName?: string;
  selectedTopic?: any;
  onPublishMessage?: (data: any) => Promise<void> | void;
  showFeedback?: (message: string, type?: string) => void;
  isConnected?: boolean;
  activeConnectionId?: string | null;
}

const api = () => window.electronAPI.recordings;

function RecordingPanel({
  connectionName,
  showFeedback,
  onPublishMessage,
  isConnected = false,
  activeConnectionId = null,
}: RecordingPanelProps) {
  const { recordings, status, ready, error: storageError, refresh, retry } = useRecordingLibrary();
  const [busy, setBusy] = useState(false);
  const [republish, setRepublish] = useState(false);

  // Playback state. Messages are read through a cursor over main's database.
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

  // UI state.
  const [expandedRecording, setExpandedRecording] = useState<number | null>(null);
  const [selectedTopicsFilter, setSelectedTopicsFilter] = useState<string[]>([]);
  const [showTopicFilter, setShowTopicFilter] = useState(false);
  const [editingRecording, setEditingRecording] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  const capture = status?.active.find((item) => item.connectionId === activeConnectionId);
  const isRecording = Boolean(capture);
  const isRecordingDisabled =
    !isConnected || !activeConnectionId || !ready || Boolean(status?.error);
  const playbackGeneration = useRef(0);

  // Captures stopped by main (storage limit or failure) are reported once.
  const seenNotice = useRef<number | null>(null);
  useEffect(() => {
    if (!status) return;
    const last = status.notices.at(-1)?.id ?? 0;
    if (seenNotice.current !== null)
      for (const notice of status.notices)
        if (notice.id > seenNotice.current)
          showFeedback?.(`Recording stopped: ${notice.reason}`, 'error');
    seenNotice.current = Math.max(seenNotice.current ?? 0, last);
  }, [status, showFeedback]);

  useEffect(() => {
    playbackGeneration.current++;
    setIsPlaying(false);
    setIsPaused(false);
    setRepublish(false);
  }, [activeConnectionId, isRecordingDisabled]);

  // A new cursor and filtered total whenever the expanded recording or topic filter changes.
  const filterKey = JSON.stringify(selectedTopicsFilter);
  useEffect(() => {
    playbackGeneration.current++;
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentIndex(0);
    setCurrentMessage(null);
    if (expandedRecording === null) {
      cursorRef.current = null;
      setPlayback(null);
      return;
    }
    const recordingId = expandedRecording;
    const topics: string[] | undefined = JSON.parse(filterKey);
    const filter = topics?.length ? topics : undefined;
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
  }, [expandedRecording, filterKey, showFeedback]);

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

  const publish = useCallback(
    async (message: StoredRecordingMessage) => {
      if (republish && isConnected && onPublishMessage)
        await onPublishMessage({
          topic: message.topic,
          payload: message.message,
          encoding: message.encoding ?? 'utf8',
          qos: message.qos,
          retain: message.retain,
        });
    },
    [republish, isConnected, onPublishMessage],
  );

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

  const startRecording = async () => {
    if (isRecordingDisabled || !activeConnectionId) return;
    setBusy(true);
    try {
      unwrap(
        await api().start(
          activeConnectionId,
          connectionName || 'Unknown',
          `Recording ${dateTime(Date.now())}`,
        ),
      );
      await refresh();
    } catch (error) {
      showFeedback?.(`Recording could not start: ${(error as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const stopRecording = async () => {
    if (!activeConnectionId) return;
    setBusy(true);
    try {
      unwrap(await api().stop(activeConnectionId));
      await refresh();
    } catch (error) {
      showFeedback?.(`Recording could not stop: ${(error as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const selectRecording = (recording: RecordingSummary) => {
    setExpandedRecording((current) => (current === recording.id ? null : recording.id));
    setSelectedTopicsFilter([]);
    setShowTopicFilter(false);
  };

  const resetPlayback = () => {
    playbackGeneration.current++;
    setCurrentIndex(0);
    setIsPlaying(false);
    setIsPaused(false);
  };

  const startRealtimePlayback = () => {
    if (!playback?.total) return;
    anchor.current = null;
    if (currentIndex >= playback.total) setCurrentIndex(0);
    setIsPlaying(true);
    setIsPaused(false);
  };

  const pausePlayback = () => {
    playbackGeneration.current++;
    setIsPlaying(false);
    setIsPaused(true);
  };

  const stepForward = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    setIsPlaying(false);
    const cursor = cursorRef.current;
    if (!cursor || !playback) return;
    const generation = ++playbackGeneration.current;
    const nextIndex = Math.min(currentIndex + stepSize, playback.total);
    try {
      let index = currentIndex;
      for (; index < nextIndex; index++) {
        const message = await cursor.at(index);
        if (playbackGeneration.current !== generation || !message) break;
        await publish(message);
      }
      if (playbackGeneration.current === generation) setCurrentIndex(index);
    } catch (error) {
      showFeedback?.(`Playback publish failed: ${(error as Error).message}`, 'error');
    }
  };

  const stepBackward = (e?: React.MouseEvent) => {
    playbackGeneration.current++;
    e?.preventDefault();
    setIsPlaying(false);
    setCurrentIndex(Math.max(currentIndex - stepSize, 0));
  };

  const toggleTopicFilter = (topic: string) => {
    setSelectedTopicsFilter((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic],
    );
  };

  const clearTopicFilter = () => setSelectedTopicsFilter([]);

  const startEditingRecording = (recording: RecordingSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingRecording(recording.id);
    setEditingName(recording.name);
  };

  const saveRecordingName = async (recordingId: number) => {
    const name = editingName.trim();
    setEditingRecording(null);
    setEditingName('');
    if (!name) return;
    try {
      unwrap(await api().rename(recordingId, name));
      await refresh();
    } catch (error) {
      showFeedback?.(`Recording could not be renamed: ${(error as Error).message}`, 'error');
    }
  };

  const cancelEditingRecording = () => {
    setEditingRecording(null);
    setEditingName('');
  };

  const handleNameKeyPress = (e: React.KeyboardEvent, recordingId: number) => {
    if (e.key === 'Enter') {
      void saveRecordingName(recordingId);
    } else if (e.key === 'Escape') {
      cancelEditingRecording();
    }
  };

  const saveRecordingToFile = async (recording: RecordingSummary) => {
    try {
      const result = unwrap(await api().export(recording.id));
      if (result.saved) showFeedback?.(`Recording exported to ${result.path}`, 'success');
    } catch (error) {
      showFeedback?.(`Recording could not be exported: ${(error as Error).message}`, 'error');
    }
  };

  // Main opens the file dialog and streams the file into storage in bounded steps.
  const [importing, setImporting] = useState(false);
  const loadRecordingFromFile = async () => {
    setImporting(true);
    try {
      const imported = unwrap(await api().import());
      if (!imported) return;
      await refresh();
      showFeedback?.(
        `Recording imported: ${imported.messageCount.toLocaleString()} messages.`,
        'success',
      );
    } catch (error) {
      showFeedback?.(`Recording could not be imported: ${(error as Error).message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const deleteRecording = async (recordingId: number) => {
    if (expandedRecording === recordingId) setExpandedRecording(null);
    try {
      unwrap(await api().delete(recordingId));
      await refresh();
    } catch (error) {
      showFeedback?.(`Recording could not be deleted: ${(error as Error).message}`, 'error');
    }
  };

  // Live counts for active captures; the list itself refreshes when captures start or stop.
  const live = (recording: RecordingSummary): RecordingSummary => {
    const active = status?.active.find((item) => item.recordingId === recording.id);
    return active && recording.state === 'active'
      ? {
          ...recording,
          messageCount: active.messageCount,
          topicCount: active.topicCount,
          dropped: Math.max(recording.dropped, active.dropped),
        }
      : recording;
  };
  const storageMessage = status?.error ?? status?.migrationError;

  return (
    <div className={`recording-main-panel ${isRecordingDisabled ? 'recording-disabled' : ''}`}>
      <div className="recording-main-header">
        <div className="header-left">
          <h2>Recording & Playback</h2>
          {isConnected ? (
            <span className="connection-indicator connected">
              <i className="fas fa-check-circle"></i> Connected
            </span>
          ) : (
            <span
              className="connection-indicator disconnected"
              title="Connect to a broker to record. Saved recordings can still be played."
            >
              <i className="fas fa-exclamation-triangle"></i> Disconnected
            </span>
          )}
        </div>
        {status?.databaseBytes !== undefined && (
          <span className="recording-storage-usage">
            {formatBytes(status.databaseBytes)} of {formatBytes(status.maxDatabaseBytes)} used
          </span>
        )}
      </div>

      {!ready && (
        <div className="recording-storage-status" role={storageError ? 'alert' : 'status'}>
          {storageError ? (
            <>
              <span>
                Recordings could not be loaded: {storageError}. Existing storage has been kept.
              </span>
              <button className="btn btn-sm" onClick={retry}>
                Retry storage
              </button>
            </>
          ) : (
            'Loading saved recordings...'
          )}
        </div>
      )}
      {storageMessage && (
        <div className="recording-storage-status" role="alert">
          <span>{storageMessage}</span>
        </div>
      )}

      <RecordingControls
        storageReady={ready && !status?.error}
        isRecording={isRecording}
        isRecordingDisabled={isRecordingDisabled}
        recordingStart={capture ? new Date(capture.startTime) : null}
        messageCount={capture?.messageCount ?? 0}
        topicCount={capture?.topicCount ?? 0}
        dropped={capture?.dropped ?? 0}
        otherRecordings={(status?.active.length ?? 0) - (capture ? 1 : 0)}
        busy={busy}
        startRecording={startRecording}
        stopRecording={stopRecording}
      />

      <CheckToggle
        className="recording-republish"
        label={`Republish playback to ${connectionName || 'the selected broker'}`}
        checked={republish}
        disabled={!isConnected || isPlaying}
        onChange={setRepublish}
      />
      <div className="recording-scrollable-content">
        <div className="recording-saved-list">
          <div className="recording-saved-list-header">
            <h3>Saved Recordings ({recordings.length})</h3>
            <button
              onClick={() => void loadRecordingFromFile()}
              disabled={!ready || importing}
              className="btn btn-md btn-primary"
              title="Load recording from file"
            >
              <i className="fas fa-upload"></i> {importing ? 'Importing…' : 'Load Recording'}
            </button>
          </div>

          {recordings.length === 0 ? (
            <div className="recording-no-recordings">
              <i className="fas fa-video"></i>
              <p>
                No recordings yet.{' '}
                {isRecordingDisabled ? 'Connect to an MQTT broker and start' : 'Start'} recording to
                capture MQTT messages or load an existing recording.
              </p>
            </div>
          ) : (
            <div className="recording-saved-items">
              {recordings.map((recording) => (
                <RecordingItem
                  key={recording.id}
                  recording={live(recording)}
                  isExpanded={expandedRecording === recording.id}
                  editingRecording={editingRecording}
                  editingName={editingName}
                  setEditingName={setEditingName}
                  onSelect={selectRecording}
                  startEditingRecording={startEditingRecording}
                  saveRecordingName={saveRecordingName}
                  handleNameKeyPress={handleNameKeyPress}
                  saveRecordingToFile={saveRecordingToFile}
                  deleteRecording={deleteRecording}
                  expandedContent={
                    expandedRecording === recording.id && playback ? (
                      <PlaybackControls
                        playback={playback}
                        currentMessage={currentMessage}
                        currentIndex={currentIndex}
                        isPlaying={isPlaying}
                        isPaused={isPaused}
                        playbackSpeed={playbackSpeed}
                        setPlaybackSpeed={setPlaybackSpeed}
                        stepSize={stepSize}
                        setStepSize={setStepSize}
                        selectedTopicsFilter={selectedTopicsFilter}
                        setSelectedTopicsFilter={setSelectedTopicsFilter}
                        showTopicFilter={showTopicFilter}
                        setShowTopicFilter={setShowTopicFilter}
                        isRecordingDisabled={isRecordingDisabled}
                        clearTopicFilter={clearTopicFilter}
                        toggleTopicFilter={toggleTopicFilter}
                        stepBackward={stepBackward}
                        resetPlayback={resetPlayback}
                        resumePlayback={startRealtimePlayback}
                        startRealtimePlayback={startRealtimePlayback}
                        pausePlayback={pausePlayback}
                        stepForward={stepForward}
                      />
                    ) : null
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RecordingPanel;
