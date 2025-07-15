import React, { useState, useEffect, useRef } from 'react';
import './RecordingPanel.css';

function RecordingPanel({ 
  messages,
  connectionName,
  selectedTopic,
  onPublishMessage,
  isConnected = false,
  activeConnectionId = null
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStart, setRecordingStart] = useState(null);
  const [recordedMessages, setRecordedMessages] = useState([]);
  const [recordings, setRecordings] = useState([]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentPlayback, setCurrentPlayback] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [stepSize, setStepSize] = useState(1);

  // UI state
  const [expandedRecording, setExpandedRecording] = useState(null);
  const [selectedTopicsFilter, setSelectedTopicsFilter] = useState([]);
  const [showTopicFilter, setShowTopicFilter] = useState(false);
  const [editingRecording, setEditingRecording] = useState(null);
  const [editingName, setEditingName] = useState('');

  // For timeout-based playback
  const playbackTimeoutsRef = useRef([]);
  const isPlayingRef = useRef(isPlaying);

  // Check if recording should be disabled
  const isRecordingDisabled = !isConnected || !activeConnectionId;

  // Keep isPlayingRef in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Disable recording if connection is lost while recording
  useEffect(() => {
    if (isRecording && isRecordingDisabled) {
      // Auto-stop recording if connection is lost
      stopRecording();
    }
  }, [isRecordingDisabled, isRecording]);

  // Load recordings from localStorage on mount
  useEffect(() => {
    const savedRecordings = localStorage.getItem('mqtt-recordings');
    if (savedRecordings) {
      try {
        const parsedRecordings = JSON.parse(savedRecordings);
        const recordingsWithDates = parsedRecordings.map(recording => ({
          ...recording,
          startTime: new Date(recording.startTime),
          endTime: new Date(recording.endTime),
          messages: recording.messages.map(msg => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
          }))
        }));
        setRecordings(recordingsWithDates);
      } catch (error) {
        console.error('Failed to load recordings:', error);
      }
    }
  }, []);

  // Save recordings to localStorage whenever recordings change
  useEffect(() => {
    localStorage.setItem('mqtt-recordings', JSON.stringify(recordings));
  }, [recordings]);

  // Update recorded messages while recording
  useEffect(() => {
    if (isRecording && recordingStart) {
      const newMessages = messages.filter(msg => 
        new Date(msg.timestamp) >= recordingStart
      );
      setRecordedMessages(newMessages);
    }
  }, [messages, isRecording, recordingStart]);

  // Cleanup playback on unmount
  useEffect(() => {
    return () => {
      clearAllPlaybackTimeouts();
    };
  }, []);

  // Update filtered messages when filter changes
  useEffect(() => {
    if (currentPlayback) {
      const filteredMessages = getFilteredMessages(currentPlayback.originalMessages);
      setCurrentPlayback(prev => ({
        ...prev,
        messages: filteredMessages
      }));
      setCurrentIndex(0);
    }
  }, [selectedTopicsFilter]);

  // --- Recording logic ---

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
      const uniqueTopics = [...new Set(recordedMessages.map(msg => msg.topic))];
      const recording = {
        id: Date.now(),
        name: `Recording ${new Date().toLocaleString()}`,
        startTime: recordingStart,
        endTime: new Date(),
        messageCount: recordedMessages.length,
        messages: [...recordedMessages],
        topic: uniqueTopics.length === 1 ? uniqueTopics[0] : `${uniqueTopics.length} Topics`,
        connectionName: connectionName || 'Unknown'
      };
      setRecordings(prev => [...prev, recording]);
      setRecordedMessages([]);
      setRecordingStart(null);
    }
  };

  // --- Playback logic ---

  const getUniqueTopics = (messages) => {
    const topics = new Set(messages.map(msg => msg.topic));
    return Array.from(topics).sort();
  };

  const getFilteredMessages = (messages) => {
    if (selectedTopicsFilter.length === 0) {
      return messages;
    }
    return messages.filter(msg => selectedTopicsFilter.includes(msg.topic));
  };

  const selectRecording = (recording) => {
    clearAllPlaybackTimeouts();
    if (expandedRecording === recording.id) {
      setExpandedRecording(null);
      setCurrentPlayback(null);
    } else {
      // Always sort messages by timestamp for playback
      const sortedMessages = [...recording.messages].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      setExpandedRecording(recording.id);
      setCurrentPlayback({
        ...recording,
        messages: sortedMessages,
        originalMessages: sortedMessages
      });
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
    playbackTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
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

    const startTime = filteredMessages[currentIndex]?.timestamp || filteredMessages[0].timestamp;
    for (let i = currentIndex; i < filteredMessages.length; i++) {
      const msg = filteredMessages[i];
      const delay = ((msg.timestamp - startTime) / playbackSpeed);

      const timeout = setTimeout(() => {
        if (!isPlayingRef.current) return;
        setCurrentIndex(idx => {
          if (onPublishMessage && isConnected) {
            onPublishMessage({
              topic: msg.topic,
              payload: msg.message,
              qos: msg.qos,
              retain: msg.retain
            });
          }
          // If last message, stop playback
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

  const stepForward = (e) => {
    if (e) e.preventDefault();
    if (!currentPlayback) return;
    const filteredMessages = currentPlayback.messages;
    let nextIndex = Math.min(currentIndex + stepSize, filteredMessages.length);
    for (let i = currentIndex; i < nextIndex; i++) {
      if (onPublishMessage && isConnected) {
        onPublishMessage({
          topic: filteredMessages[i].topic,
          payload: filteredMessages[i].message,
          qos: filteredMessages[i].qos,
          retain: filteredMessages[i].retain
        });
      }
    }
    setCurrentIndex(nextIndex);
  };

  const stepBackward = (e) => {
    if (e) e.preventDefault();
    if (!currentPlayback) return;
    let prevIndex = Math.max(currentIndex - stepSize, 0);
    setCurrentIndex(prevIndex);
  };

  const toggleTopicFilter = (topic) => {
    setSelectedTopicsFilter(prev => {
      if (prev.includes(topic)) {
        return prev.filter(t => t !== topic);
      } else {
        return [...prev, topic];
      }
    });
  };

  const clearTopicFilter = () => {
    setSelectedTopicsFilter([]);
  };

  // Rename recording functionality
  const startEditingRecording = (recording, e) => {
    e.stopPropagation();
    setEditingRecording(recording.id);
    setEditingName(recording.name);
  };

  const saveRecordingName = (recordingId) => {
    if (editingName.trim()) {
      setRecordings(prev => prev.map(recording => 
        recording.id === recordingId 
          ? { ...recording, name: editingName.trim() }
          : recording
      ));
    }
    setEditingRecording(null);
    setEditingName('');
  };

  const cancelEditingRecording = () => {
    setEditingRecording(null);
    setEditingName('');
  };

  const handleNameKeyPress = (e, recordingId) => {
    if (e.key === 'Enter') {
      saveRecordingName(recordingId);
    } else if (e.key === 'Escape') {
      cancelEditingRecording();
    }
  };

  // Save recording to file system
  const saveRecordingToFile = (recording) => {
    const exportData = {
      recordingInfo: {
        name: recording.name,
        startTime: recording.startTime,
        endTime: recording.endTime,
        duration: recording.endTime - recording.startTime,
        messageCount: recording.messageCount,
        topic: recording.topic,
        connectionName: recording.connectionName
      },
      messages: recording.messages.map(msg => ({
        timestamp: msg.timestamp,
        topic: msg.topic,
        payload: msg.message,
        qos: msg.qos,
        retain: msg.retain,
        connectionId: msg.connectionId
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
      type: 'application/json' 
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mqtt-recording-${recording.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Load recording from file
  const loadRecordingFromFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = JSON.parse(e.target.result);
            if (data.recordingInfo && data.messages) {
              const recording = {
                id: Date.now(),
                name: data.recordingInfo.name + ' (Imported)',
                startTime: new Date(data.recordingInfo.startTime),
                endTime: new Date(data.recordingInfo.endTime),
                messageCount: data.recordingInfo.messageCount,
                topic: data.recordingInfo.topic,
                connectionName: data.recordingInfo.connectionName,
                messages: data.messages.map(msg => ({
                  ...msg,
                  timestamp: new Date(msg.timestamp),
                  message: msg.payload
                }))
              };
              setRecordings(prev => [...prev, recording]);
              alert('Recording loaded successfully!');
            } else {
              alert('Invalid recording file format.');
            }
          } catch (error) {
            alert('Error reading recording file: ' + error.message);
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const deleteRecording = (recordingId) => {
    setRecordings(prev => {
      const newRecordings = prev.filter(r => r.id !== recordingId);
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

  const getCurrentMessage = () => {
    if (!currentPlayback) return null;
    const filteredMessages = currentPlayback.messages;
    return filteredMessages[currentIndex] || null;
  };

  const formatPayload = (payload) => {
    try {
      const parsed = JSON.parse(payload);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return payload;
    }
  };

  // --- UI ---
  return (
    <div className={`recording-main-panel ${isRecordingDisabled ? 'recording-disabled' : ''}`}>
      <div className="recording-main-header">
        <div className="recording-header-left">
          <h2>
            Recording & Playback
            {isRecordingDisabled && (
              <span className="recording-connection-status">
                <i className="fas fa-exclamation-triangle"></i>
                No Active Connection
              </span>
            )}
          </h2>
        </div>
      </div>
      
      {/* Fixed Controls Section */}
      <div className="recording-fixed-controls">
        {isRecordingDisabled && (
          <div className="recording-connection-warning">
            <div className="recording-warning-content">
              <i className="fas fa-plug"></i>
              <h3>No Active Connection</h3>
              <p>Please connect to an MQTT broker to start recording messages.</p>
              <p>You can still view and playback existing recordings below.</p>
            </div>
          </div>
        )}

        <div className={`recording-controls-section ${isRecordingDisabled ? 'recording-controls-disabled' : ''}`}>
          <div className="recording-status-area">
            <div className={`recording-status-indicator ${isRecording ? 'recording-active' : 'recording-stopped'} ${isRecordingDisabled ? 'recording-indicator-disabled' : ''}`}>
              <i className={`fas fa-${isRecording ? 'circle' : 'stop-circle'}`}></i>
              {isRecording ? 'Recording...' : isRecordingDisabled ? 'Connection Required' : 'Ready to Record'}
            </div>
            {isRecording && (
              <div className="recording-live-info">
                <span>Started: {recordingStart?.toLocaleTimeString()}</span>
                <span>Messages: {recordedMessages.length}</span>
                <span>Topics: {[...new Set(recordedMessages.map(msg => msg.topic))].length}</span>
              </div>
            )}
          </div>
          <div className="recording-action-buttons">
            {!isRecording ? (
              <button 
                onClick={startRecording} 
                className="recording-start-btn"
                disabled={isRecordingDisabled}
                title={isRecordingDisabled ? 'Connect to an MQTT broker to start recording' : 'Start recording messages'}
              >
                <i className="fas fa-record-vinyl"></i> Record
              </button>
            ) : (
              <button onClick={stopRecording} className="recording-stop-btn">
                <i className="fas fa-stop"></i> Stop
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="recording-scrollable-content">
        {/* Recordings List */}
        <div className="recording-saved-list">
          <div className="recording-saved-list-header">
            <h3>Saved Recordings ({recordings.length})</h3>
            <button 
              onClick={loadRecordingFromFile}
              className="recording-load-btn"
              title="Load recording from file"
            >
              <i className="fas fa-upload"></i> Load Recording
            </button>
          </div>

          {recordings.length === 0 ? (
            <div className="recording-no-recordings">
              <i className="fas fa-video"></i>
              <p>No recordings yet. {isRecordingDisabled ? 'Connect to an MQTT broker and start' : 'Start'} recording to capture MQTT messages or load an existing recording.</p>
            </div>
          ) : (
            <div className="recording-saved-items">
              {recordings.map(recording => (
                <div 
                  key={recording.id} 
                  className={`recording-saved-item ${expandedRecording === recording.id ? 'recording-item-expanded' : ''}`}
                >
                  {/* Recording Header */}
                  <div 
                    className="recording-item-header"
                    onClick={() => selectRecording(recording)}
                  >
                    <div className="recording-item-title">
                      <i className={`fas fa-${expandedRecording === recording.id ? 'chevron-down' : 'chevron-right'}`}></i>
                      <i className="fas fa-video"></i>
                      {editingRecording === recording.id ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => saveRecordingName(recording.id)}
                          onKeyDown={(e) => handleNameKeyPress(e, recording.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="recording-name-input"
                          autoFocus
                        />
                      ) : (
                        <span 
                          onDoubleClick={(e) => startEditingRecording(recording, e)}
                          className="recording-name-text"
                          title="Double-click to rename"
                        >
                          {recording.name}
                        </span>
                      )}
                    </div>
                    <div className="recording-item-actions" onClick={(e) => e.stopPropagation()}>
                      <button 
                        onClick={(e) => startEditingRecording(recording, e)}
                        className="recording-edit-btn"
                        title="Rename recording"
                      >
                        <i className="fas fa-edit"></i>
                      </button>
                      <button 
                        onClick={() => saveRecordingToFile(recording)}
                        className="recording-save-btn"
                        title="Save recording to file"
                      >
                        <i className="fas fa-save"></i>
                      </button>
                      <button 
                        onClick={() => deleteRecording(recording.id)}
                        className="recording-delete-btn"
                        title="Delete recording"
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>
                  
                  {/* Recording Details */}
                  <div className="recording-item-summary">
                    <div className="recording-item-stats">
                      <span><i className="fas fa-envelope"></i> {recording.messageCount} messages</span>
                      <span><i className="fas fa-clock"></i> {Math.round((recording.endTime - recording.startTime) / 1000)}s</span>
                      <span><i className="fas fa-tag"></i> {recording.topic}</span>
                      <span><i className="fas fa-list"></i> {getUniqueTopics(recording.messages).length} topics</span>
                    </div>
                    <div className="recording-item-time">
                      {recording.startTime.toLocaleString()} - {recording.endTime.toLocaleString()}
                    </div>
                  </div>

                  {/* Expanded Content - Show warning if trying to playback without connection */}
                  {expandedRecording === recording.id && currentPlayback && (
                    <div className="recording-expanded-area">
                      {isRecordingDisabled && (
                        <div className="recording-playback-warning">
                          <i className="fas fa-exclamation-triangle"></i>
                          <strong>Note:</strong> Connect to an MQTT broker to publish messages during playback.
                        </div>
                      )}

                      {/* Topic Filter */}
                      <div className="recording-topic-filter-section">
                        <button 
                          onClick={() => setShowTopicFilter(!showTopicFilter)}
                          className="recording-filter-toggle-btn"
                        >
                          <i className="fas fa-filter"></i> 
                          Topic Filter ({selectedTopicsFilter.length} of {getUniqueTopics(currentPlayback.originalMessages).length} selected)
                        </button>
                        {showTopicFilter && (
                          <div className="recording-topic-filter-panel">
                            <div className="recording-filter-actions">
                              <button onClick={() => setSelectedTopicsFilter(getUniqueTopics(currentPlayback.originalMessages))} className="recording-select-all-btn">
                                Select All
                              </button>
                              <button onClick={clearTopicFilter} className="recording-clear-filter-btn">
                                Clear All
                              </button>
                            </div>
                            <div className="recording-topic-list">
                              {getUniqueTopics(currentPlayback.originalMessages).map(topic => (
                                <label key={topic} className="recording-topic-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={selectedTopicsFilter.includes(topic)}
                                    onChange={() => toggleTopicFilter(topic)}
                                  />
                                  {topic}
                                </label>
                              ))}
                            </div>
                            <div className="recording-filter-summary">
                              Filtered messages: {currentPlayback.messages.length} of {currentPlayback.originalMessages.length}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Playback Controls */}
                      <div className="recording-playback-section">
                        {/* Progress Bar */}
                        <div className="recording-playback-progress">
                          <div className="recording-progress-bar">
                            <div 
                              className="recording-progress-fill" 
                              style={{ width: `${currentPlayback.messages.length === 0 ? 0 : (currentIndex / currentPlayback.messages.length) * 100}%` }}
                            ></div>
                          </div>
                          <span>{currentPlayback.messages.length === 0 ? 0 : Math.round((currentIndex / currentPlayback.messages.length) * 100)}%</span>
                        </div>

                        {/* Main Controls */}
                        <div className="recording-main-controls">
                          <button 
                            onClick={stepBackward} 
                            className="recording-step-btn"
                            disabled={currentIndex === 0}
                          >
                            <i className="fas fa-step-backward"></i>
                          </button>
                          
                          <button 
                            onClick={resetPlayback}
                            className="recording-reset-btn"
                            title="Reset to beginning"
                          >
                            <i className="fas fa-undo"></i>
                          </button>

                          {!isPlaying ? (
                            <button 
                              onClick={isPaused ? resumePlayback : startRealtimePlayback}
                              className="recording-play-btn recording-main-play-btn"
                              title={isRecordingDisabled ? 'Playback will not publish messages (no connection)' : 'Start playback'}
                            >
                              <i className="fas fa-play"></i>
                            </button>
                          ) : (
                            <button 
                              onClick={pausePlayback}
                              className="recording-pause-btn recording-main-pause-btn"
                            >
                              <i className="fas fa-pause"></i>
                            </button>
                          )}

                          <button 
                            onClick={stepForward} 
                            className="recording-step-btn"
                            disabled={currentIndex >= (currentPlayback.messages.length)}
                          >
                            <i className="fas fa-step-forward"></i>
                          </button>
                        </div>

                        {/* Settings Row */}
                        <div className="recording-playback-settings">
                          <div className="recording-speed-control">
                            <label>Speed: </label>
                            <select 
                              value={playbackSpeed} 
                              onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                            >
                              <option value={0.25}>0.25x</option>
                              <option value={0.5}>0.5x</option>
                              <option value={1}>1x</option>
                              <option value={2}>2x</option>
                              <option value={4}>4x</option>
                            </select>
                          </div>
                          
                          <div className="recording-step-size-control">
                            <label>Step Size: </label>
                            <select 
                              value={stepSize} 
                              onChange={(e) => setStepSize(parseInt(e.target.value))}
                            >
                              <option value={1}>1 msg</option>
                              <option value={5}>5 msgs</option>
                              <option value={10}>10 msgs</option>
                              <option value={25}>25 msgs</option>
                              <option value={50}>50 msgs</option>
                            </select>
                          </div>
                        </div>

                        {/* Current Message Info */}
                        {getCurrentMessage() && (
                          <div className="recording-current-message-info">
                            <div className="recording-message-position">
                              <strong>Position:</strong>
                              <span>Message {currentIndex + 1} of {currentPlayback.messages.length}</span>
                            </div>
                            <div className="recording-message-details">
                              <div>
                                <strong>Topic:</strong>
                                <span>{getCurrentMessage().topic}</span>
                              </div>
                              <div>
                                <strong>Time:</strong>
                                <span>{new Date(getCurrentMessage().timestamp).toLocaleTimeString()}</span>
                              </div>
                              <div>
                                <strong>QoS:</strong>
                                <span>{getCurrentMessage().qos || 0}</span>
                              </div>
                              <div>
                                <strong>Retain:</strong>
                                <span>{getCurrentMessage().retain ? 'Yes' : 'No'}</span>
                              </div>
                            </div>
                            <div className="recording-message-payload">
                              <strong>Payload:</strong>
                              <pre className="recording-payload-content">{formatPayload(getCurrentMessage().message || '')}</pre>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default RecordingPanel;