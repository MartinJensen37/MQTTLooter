import React, { useState, useEffect, useRef, useCallback } from 'react';
import './RecordingPanel.css';
import MQTTService from '../../services/MQTTService';
import RecordingCapture from '../../services/RecordingCapture';
import { useRecordingLibrary } from '../../hooks/useRecordingLibrary';
import { parseRecording } from './recordingPanel/parseRecording';
import type { Recording, CurrentPlayback } from './recordingPanel/types';
import { getFilteredMessagesFor } from './recordingPanel/recordingHelpers';
import RecordingControls from './recordingPanel/RecordingControls';
import RecordingItem from './recordingPanel/RecordingItem';
import PlaybackControls from './recordingPanel/PlaybackControls';

interface RecordingPanelProps {
  connectionName?: string;
  selectedTopic?: any;
  onPublishMessage?: (data: any) => Promise<void> | void;
  showFeedback?: (message: string, type?: string) => void;
  isConnected?: boolean;
  activeConnectionId?: string | null;
}

function RecordingPanel({
  connectionName,
  showFeedback,
  onPublishMessage,
  isConnected = false,
  activeConnectionId = null,
}: RecordingPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStart, setRecordingStart] = useState<Date | null>(null);
  const captureRef = useRef<RecordingCapture | null>(null);
  const [captureCounts, setCaptureCounts] = useState({ messages: 0, topics: 0 });
  const [republish, setRepublish] = useState(false);
  const {
    recordings,
    setRecordings,
    addRecording,
    ready,
    status,
    error: storageError,
    retry,
  } = useRecordingLibrary();

  // Playback state.
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentPlayback, setCurrentPlayback] = useState<CurrentPlayback | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [stepSize, setStepSize] = useState(1);

  // UI state.
  const [expandedRecording, setExpandedRecording] = useState<number | null>(null);
  const [selectedTopicsFilter, setSelectedTopicsFilter] = useState<string[]>([]);
  const [showTopicFilter, setShowTopicFilter] = useState(false);
  const [editingRecording, setEditingRecording] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  const isRecordingDisabled = !isConnected || !activeConnectionId || !ready;
  const playbackGeneration = useRef(0);

  const stopRecording = useCallback(() => {
    const recording = captureRef.current?.finish();
    captureRef.current = null;
    setIsRecording(false);
    setRecordingStart(null);
    setCaptureCounts({ messages: 0, topics: 0 });
    if (recording) addRecording(recording);
  }, [addRecording]);

  useEffect(() => {
    const generation = playbackGeneration;
    const onMessage = (data: any) => {
      if (captureRef.current && !captureRef.current.add(data)) {
        stopRecording();
        showFeedback?.('Recording stopped at the 10,000-message or 2 MB capture limit.', 'info');
      }
    };
    const onDisconnect = (data: any) => {
      if (captureRef.current?.connectionId === data.id) stopRecording();
    };
    const onGap = (data: any) => {
      const capture = captureRef.current;
      if (!capture || capture.connectionId !== data.id) return;
      capture.incompleteReason = 'Incoming message delivery has a gap.';
      stopRecording();
      showFeedback?.(
        'Recording stopped: incoming message delivery has a gap. The saved capture is incomplete.',
        'error',
      );
    };
    MQTTService.onAny('delivery-gap', onGap);
    MQTTService.onAny('message', onMessage);
    MQTTService.onAny('disconnected', onDisconnect);
    const timer = setInterval(() => {
      const capture = captureRef.current;
      if (capture)
        setCaptureCounts({ messages: capture.messages.length, topics: capture.topics.size });
    }, 250);
    return () => {
      generation.current++;
      MQTTService.off('*', 'delivery-gap', onGap);
      MQTTService.off('*', 'message', onMessage);
      MQTTService.off('*', 'disconnected', onDisconnect);
      clearInterval(timer);
    };
  }, [stopRecording, showFeedback]);

  useEffect(() => {
    playbackGeneration.current++;
    if (
      captureRef.current &&
      (isRecordingDisabled || captureRef.current.connectionId !== activeConnectionId)
    )
      stopRecording();
    setIsPlaying(false);
    setIsPaused(false);
    setRepublish(false);
  }, [activeConnectionId, isRecordingDisabled, stopRecording]);

  useEffect(() => {
    playbackGeneration.current++;
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentPlayback((prev) =>
      prev
        ? { ...prev, messages: getFilteredMessagesFor(prev.originalMessages, selectedTopicsFilter) }
        : null,
    );
    setCurrentIndex(0);
  }, [selectedTopicsFilter]);

  // Only one timer is live. Publishing is never performed inside a React state updater.
  useEffect(() => {
    if (!isPlaying || !currentPlayback) return;
    const msg = currentPlayback.messages[currentIndex];
    if (!msg) {
      setIsPlaying(false);
      setIsPaused(false);
      return;
    }
    const previous = currentPlayback.messages[currentIndex - 1];
    const delay = previous
      ? Math.max(
          0,
          (new Date(msg.timestamp).getTime() - new Date(previous.timestamp).getTime()) /
            playbackSpeed,
        )
      : 0;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        try {
          if (republish && isConnected && onPublishMessage) {
            await onPublishMessage({
              topic: msg.topic,
              payload: msg.message,
              encoding: msg.encoding ?? 'utf8',
              qos: msg.qos,
              retain: msg.retain,
            });
          }
          if (!cancelled) setCurrentIndex(currentIndex + 1);
        } catch (error) {
          if (!cancelled) {
            setIsPlaying(false);
            showFeedback?.(`Playback publish failed: ${(error as Error).message}`, 'error');
          }
        }
      },
      Math.min(delay, 2_147_483_647),
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    isPlaying,
    currentPlayback,
    currentIndex,
    playbackSpeed,
    republish,
    isConnected,
    onPublishMessage,
    showFeedback,
  ]);

  const startRecording = () => {
    if (isRecordingDisabled || !activeConnectionId) return;
    captureRef.current = new RecordingCapture(activeConnectionId, connectionName || 'Unknown');
    setRecordingStart(captureRef.current.startTime);
    setCaptureCounts({ messages: 0, topics: 0 });
    setIsRecording(true);
  };

  const selectRecording = (recording: Recording) => {
    playbackGeneration.current++;
    setIsPlaying(false);
    if (expandedRecording === recording.id) {
      setIsPlaying(false);
      setExpandedRecording(null);
      setCurrentPlayback(null);
    } else {
      const sortedMessages = [...recording.messages].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      setExpandedRecording(recording.id);
      setCurrentPlayback({
        ...recording,
        messages: sortedMessages,
        originalMessages: sortedMessages,
      });
      setCurrentIndex(0);
      setIsPlaying(false);
      setIsPaused(false);
      setSelectedTopicsFilter([]);
      setShowTopicFilter(false);
    }
  };

  const resetPlayback = () => {
    playbackGeneration.current++;
    setCurrentIndex(0);
    setIsPlaying(false);
    setIsPaused(false);
  };

  const startRealtimePlayback = () => {
    if (!currentPlayback?.messages.length) return;
    if (currentIndex >= currentPlayback.messages.length) setCurrentIndex(0);
    setIsPlaying(true);
    setIsPaused(false);
  };

  const pausePlayback = () => {
    playbackGeneration.current++;
    setIsPlaying(false);
    setIsPaused(true);
  };
  const resumePlayback = startRealtimePlayback;

  const stepForward = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    setIsPlaying(false);
    if (!currentPlayback) return;
    const generation = ++playbackGeneration.current;
    const nextIndex = Math.min(currentIndex + stepSize, currentPlayback.messages.length);
    try {
      for (let i = currentIndex; i < nextIndex; i++) {
        if (playbackGeneration.current !== generation) return;
        const msg = currentPlayback.messages[i];
        if (republish && isConnected && onPublishMessage) {
          await onPublishMessage({
            topic: msg.topic,
            payload: msg.message,
            encoding: msg.encoding ?? 'utf8',
            qos: msg.qos,
            retain: msg.retain,
          });
        }
      }
      if (playbackGeneration.current === generation) setCurrentIndex(nextIndex);
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

  const startEditingRecording = (recording: Recording, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingRecording(recording.id);
    setEditingName(recording.name);
  };

  const saveRecordingName = (recordingId: number) => {
    if (editingName.trim()) {
      setRecordings((prev) =>
        prev.map((recording) =>
          recording.id === recordingId ? { ...recording, name: editingName.trim() } : recording,
        ),
      );
    }
    setEditingRecording(null);
    setEditingName('');
  };

  const cancelEditingRecording = () => {
    setEditingRecording(null);
    setEditingName('');
  };

  const handleNameKeyPress = (e: React.KeyboardEvent, recordingId: number) => {
    if (e.key === 'Enter') {
      saveRecordingName(recordingId);
    } else if (e.key === 'Escape') {
      cancelEditingRecording();
    }
  };

  const saveRecordingToFile = (recording: Recording) => {
    const exportData = {
      recordingInfo: {
        name: recording.name,
        startTime: recording.startTime,
        endTime: recording.endTime,
        duration: recording.endTime.getTime() - recording.startTime.getTime(),
        messageCount: recording.messageCount,
        topic: recording.topic,
        connectionName: recording.connectionName,
        incompleteReason: recording.incompleteReason,
      },
      messages: recording.messages.map((msg) => ({
        timestamp: msg.timestamp,
        topic: msg.topic,
        payload: msg.message,
        encoding: msg.encoding ?? 'utf8',
        qos: msg.qos,
        retain: msg.retain,
        connectionId: msg.connectionId,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mqtt-recording-${recording.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const loadRecordingFromFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        alert('Recording files must be at most 10 MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          if (data.recordingInfo && data.messages) {
            const recording = parseRecording(data);
            recording.name += ' (Imported)';
            addRecording(recording);
            showFeedback?.('Recording imported. Check the save status before closing.', 'info');
          } else {
            alert('Invalid recording file format.');
          }
        } catch (error: any) {
          alert('Error reading recording file: ' + error.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const deleteRecording = (recordingId: number) => {
    playbackGeneration.current++;
    setRecordings((prev) => prev.filter((r) => r.id !== recordingId));
    if (expandedRecording === recordingId) {
      setIsPlaying(false);
      setExpandedRecording(null);
      setCurrentPlayback(null);
    }
  };

  return (
    <div className={`recording-main-panel ${isRecordingDisabled ? 'recording-disabled' : ''}`}>
      <div className="recording-main-header">
        <div className="header-left">
          <h2>Recording & Playback</h2>
        </div>
      </div>

      <div className="recording-storage-status" role={status === 'error' ? 'alert' : 'status'}>
        {status === 'loading' && 'Loading saved recordings...'}
        {status === 'saving' && 'Saving recordings to disk...'}
        {status === 'saved' && 'Saved recordings are stored on disk.'}
        {status === 'error' && (
          <>
            <span>
              Recordings could not be {ready ? 'saved' : 'loaded'}: {storageError}.{' '}
              {ready
                ? 'Unsaved changes remain in memory; retry or export recordings before closing.'
                : 'Existing storage has been kept.'}
            </span>
            <button className="btn btn-sm" onClick={retry}>
              Retry storage
            </button>
          </>
        )}
        {isRecording && <span> The active capture is saved when stopped.</span>}
      </div>

      <RecordingControls
        storageReady={ready}
        isRecording={isRecording}
        isRecordingDisabled={isRecordingDisabled}
        recordingStart={recordingStart}
        messageCount={captureCounts.messages}
        topicCount={captureCounts.topics}
        startRecording={startRecording}
        stopRecording={stopRecording}
      />

      <label className="recording-controls-section">
        <input
          type="checkbox"
          checked={republish}
          disabled={!isConnected || isPlaying}
          onChange={(e) => setRepublish(e.target.checked)}
        />
        Republish playback messages to {connectionName || 'the selected broker'}
      </label>
      <div className="recording-scrollable-content">
        <div className="recording-saved-list">
          <div className="recording-saved-list-header">
            <h3>Saved Recordings ({recordings.length})</h3>
            <button
              onClick={loadRecordingFromFile}
              disabled={!ready}
              className="btn btn-md btn-primary"
              title="Load recording from file"
            >
              <i className="fas fa-upload"></i> Load Recording
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
                  recording={recording}
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
                    expandedRecording === recording.id && currentPlayback ? (
                      <PlaybackControls
                        currentPlayback={currentPlayback}
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
                        resumePlayback={resumePlayback}
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
