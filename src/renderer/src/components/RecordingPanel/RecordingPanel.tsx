import React, { useState, useEffect, useRef } from 'react';
import './RecordingPanel.css';
import type { RecordedMessage, Recording, CurrentPlayback } from './recordingPanel/types';
import { getFilteredMessagesFor } from './recordingPanel/recordingHelpers';
import RecordingControls from './recordingPanel/RecordingControls';
import RecordingItem from './recordingPanel/RecordingItem';
import PlaybackControls from './recordingPanel/PlaybackControls';

interface RecordingPanelProps {
  messages: RecordedMessage[];
  connectionName?: string;
  selectedTopic?: any;
  onPublishMessage?: (data: any) => void;
  isConnected?: boolean;
  activeConnectionId?: string | null;
}

function RecordingPanel({
  messages,
  connectionName,
  onPublishMessage,
  isConnected = false,
  activeConnectionId = null,
}: RecordingPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStart, setRecordingStart] = useState<Date | null>(null);
  const [recordedMessages, setRecordedMessages] = useState<RecordedMessage[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);

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

  const playbackTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isPlayingRef = useRef(isPlaying);

  const isRecordingDisabled = !isConnected || !activeConnectionId;

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Auto-stop recording if the connection is lost.
  useEffect(() => {
    if (isRecording && isRecordingDisabled) {
      stopRecording();
    }
  }, [isRecordingDisabled, isRecording]);

  // Load recordings from localStorage (rehydrating Date fields).
  useEffect(() => {
    const savedRecordings = localStorage.getItem('mqtt-recordings');
    if (savedRecordings) {
      try {
        const parsedRecordings = JSON.parse(savedRecordings);
        const recordingsWithDates: Recording[] = parsedRecordings.map((recording: any) => ({
          ...recording,
          startTime: new Date(recording.startTime),
          endTime: new Date(recording.endTime),
          messages: recording.messages.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp),
          })),
        }));
        setRecordings(recordingsWithDates);
      } catch (error) {
        console.error('Failed to load recordings:', error);
      }
    }
  }, []);

  // Persist recordings.
  useEffect(() => {
    localStorage.setItem('mqtt-recordings', JSON.stringify(recordings));
  }, [recordings]);

  // Capture incoming messages while recording.
  useEffect(() => {
    if (isRecording && recordingStart) {
      setRecordedMessages(messages.filter((msg) => new Date(msg.timestamp) >= recordingStart));
    }
  }, [messages, isRecording, recordingStart]);

  // Cancel pending playback timeouts on unmount.
  useEffect(() => {
    return () => clearAllPlaybackTimeouts();
  }, []);

  // Re-filter playback messages when the topic filter changes.
  useEffect(() => {
    if (currentPlayback) {
      const filteredMessages = getFilteredMessagesFor(
        currentPlayback.originalMessages,
        selectedTopicsFilter,
      );
      setCurrentPlayback((prev) => (prev ? { ...prev, messages: filteredMessages } : prev));
      setCurrentIndex(0);
    }
  }, [selectedTopicsFilter]);

  const startRecording = () => {
    if (isRecordingDisabled) {
      alert('Please connect to an MQTT broker before starting a recording.');
      return;
    }
    setIsRecording(true);
    setRecordingStart(new Date());
    setRecordedMessages([]);
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (recordedMessages.length > 0) {
      const uniqueTopics = [...new Set(recordedMessages.map((msg) => msg.topic))];
      const recording: Recording = {
        id: Date.now(),
        name: `Recording ${new Date().toLocaleString()}`,
        startTime: recordingStart!,
        endTime: new Date(),
        messageCount: recordedMessages.length,
        messages: [...recordedMessages],
        topic: uniqueTopics.length === 1 ? uniqueTopics[0] : `${uniqueTopics.length} Topics`,
        connectionName: connectionName || 'Unknown',
      };
      setRecordings((prev) => [...prev, recording]);
      setRecordedMessages([]);
      setRecordingStart(null);
    }
  };

  const selectRecording = (recording: Recording) => {
    clearAllPlaybackTimeouts();
    if (expandedRecording === recording.id) {
      setExpandedRecording(null);
      setCurrentPlayback(null);
    } else {
      const sortedMessages = [...recording.messages].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      setExpandedRecording(recording.id);
      setCurrentPlayback({ ...recording, messages: sortedMessages, originalMessages: sortedMessages });
      setCurrentIndex(0);
      setIsPlaying(false);
      setIsPaused(false);
      setSelectedTopicsFilter([]);
      setShowTopicFilter(false);
    }
  };

  const resetPlayback = () => {
    clearAllPlaybackTimeouts();
    setCurrentIndex(0);
    setIsPlaying(false);
    setIsPaused(false);
  };

  function clearAllPlaybackTimeouts() {
    playbackTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    playbackTimeoutsRef.current = [];
  }

  const startRealtimePlayback = () => {
    if (!currentPlayback) return;
    const filteredMessages = currentPlayback.messages;
    if (filteredMessages.length === 0) {
      alert('No messages match the selected topic filter.');
      return;
    }
    setIsPlaying(true);
    setIsPaused(false);
    clearAllPlaybackTimeouts();

    const startTime = filteredMessages[currentIndex]?.timestamp ?? filteredMessages[0].timestamp;
    for (let i = currentIndex; i < filteredMessages.length; i++) {
      const msg = filteredMessages[i];
      const delay = (new Date(msg.timestamp).getTime() - new Date(startTime).getTime()) / playbackSpeed;

      const timeout = setTimeout(() => {
        if (!isPlayingRef.current) return;
        setCurrentIndex(() => {
          if (onPublishMessage && isConnected) {
            onPublishMessage({
              topic: msg.topic,
              payload: msg.message,
              qos: msg.qos,
              retain: msg.retain,
            });
          }
          if (i === filteredMessages.length - 1) {
            setIsPlaying(false);
            setIsPaused(false);
          }
          return i + 1;
        });
      }, delay);

      playbackTimeoutsRef.current.push(timeout);
    }
  };

  const pausePlayback = () => {
    clearAllPlaybackTimeouts();
    setIsPlaying(false);
    setIsPaused(true);
  };

  const resumePlayback = () => {
    setIsPlaying(true);
    setIsPaused(false);
    startRealtimePlayback();
  };

  const stepForward = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!currentPlayback) return;
    const filteredMessages = currentPlayback.messages;
    const nextIndex = Math.min(currentIndex + stepSize, filteredMessages.length);
    for (let i = currentIndex; i < nextIndex; i++) {
      if (onPublishMessage && isConnected) {
        onPublishMessage({
          topic: filteredMessages[i].topic,
          payload: filteredMessages[i].message,
          qos: filteredMessages[i].qos,
          retain: filteredMessages[i].retain,
        });
      }
    }
    setCurrentIndex(nextIndex);
  };

  const stepBackward = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!currentPlayback) return;
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
      },
      messages: recording.messages.map((msg) => ({
        timestamp: msg.timestamp,
        topic: msg.topic,
        payload: msg.message,
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
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          if (data.recordingInfo && data.messages) {
            const recording: Recording = {
              id: Date.now(),
              name: data.recordingInfo.name + ' (Imported)',
              startTime: new Date(data.recordingInfo.startTime),
              endTime: new Date(data.recordingInfo.endTime),
              messageCount: data.recordingInfo.messageCount,
              topic: data.recordingInfo.topic,
              connectionName: data.recordingInfo.connectionName,
              messages: data.messages.map((msg: any) => ({
                ...msg,
                timestamp: new Date(msg.timestamp),
                message: msg.payload,
              })),
            };
            setRecordings((prev) => [...prev, recording]);
            alert('Recording loaded successfully!');
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
    setRecordings((prev) => {
      const newRecordings = prev.filter((r) => r.id !== recordingId);
      if (newRecordings.length === 0) {
        localStorage.removeItem('mqtt-recordings');
      }
      return newRecordings;
    });
    if (expandedRecording === recordingId) {
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

      <RecordingControls
        isRecording={isRecording}
        isRecordingDisabled={isRecordingDisabled}
        recordingStart={recordingStart}
        recordedMessages={recordedMessages}
        startRecording={startRecording}
        stopRecording={stopRecording}
      />

      <div className="recording-scrollable-content">
        <div className="recording-saved-list">
          <div className="recording-saved-list-header">
            <h3>Saved Recordings ({recordings.length})</h3>
            <button
              onClick={loadRecordingFromFile}
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
