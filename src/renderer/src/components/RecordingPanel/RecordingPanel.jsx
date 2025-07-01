import React, { useState, useEffect } from 'react';
import './RecordingPanel.css';

function RecordingPanel({ 
  messages,
  connectionName,
  selectedTopic 
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStart, setRecordingStart] = useState(null);
  const [recordedMessages, setRecordedMessages] = useState([]);
  const [recordings, setRecordings] = useState([]);

  // Filter messages based on recording state
  useEffect(() => {
    if (isRecording && recordingStart) {
      const newMessages = messages.filter(msg => 
        new Date(msg.timestamp) >= recordingStart &&
        (!selectedTopic || msg.topic === selectedTopic.topicPath)
      );
      setRecordedMessages(newMessages);
    }
  }, [messages, isRecording, recordingStart, selectedTopic]);

  const startRecording = () => {
    setIsRecording(true);
    setRecordingStart(new Date());
    setRecordedMessages([]);
  };

  const stopRecording = () => {
    if (recordedMessages.length > 0) {
      const recording = {
        id: Date.now(),
        name: `Recording ${new Date().toLocaleString()}`,
        startTime: recordingStart,
        endTime: new Date(),
        messageCount: recordedMessages.length,
        messages: [...recordedMessages],
        topic: selectedTopic?.topicPath || 'All Topics',
        connectionName: connectionName || 'Unknown'
      };
      
      setRecordings(prev => [...prev, recording]);
    }
    
    setIsRecording(false);
    setRecordingStart(null);
    setRecordedMessages([]);
  };

  const exportRecording = (recording) => {
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

  const deleteRecording = (recordingId) => {
    setRecordings(prev => prev.filter(r => r.id !== recordingId));
  };

  return (
    <div className="recording-panel">
      <div className="recording-panel-header">
        <h2>Message Recording</h2>
      </div>

      <div className="recording-content">
        <div className="recording-controls">
          <div className="recording-status">
            <div className={`status-indicator ${isRecording ? 'recording' : 'stopped'}`}>
              <i className={`fas fa-${isRecording ? 'circle' : 'stop-circle'}`}></i>
              {isRecording ? 'Recording...' : 'Stopped'}
            </div>
            
            {isRecording && (
              <div className="recording-info">
                <span>Started: {recordingStart?.toLocaleTimeString()}</span>
                <span>Messages: {recordedMessages.length}</span>
                {selectedTopic && <span>Topic: {selectedTopic.topicPath}</span>}
              </div>
            )}
          </div>

          <div className="recording-buttons">
            {!isRecording ? (
              <button onClick={startRecording} className="start-recording-btn">
                <i className="fas fa-play"></i> Start Recording
              </button>
            ) : (
              <button onClick={stopRecording} className="stop-recording-btn">
                <i className="fas fa-stop"></i> Stop Recording
              </button>
            )}
          </div>
        </div>

        <div className="recordings-list">
          <h3>Saved Recordings ({recordings.length})</h3>
          
          {recordings.length === 0 ? (
            <div className="no-recordings">
              <i className="fas fa-video"></i>
              <p>No recordings yet. Start recording to capture MQTT messages.</p>
            </div>
          ) : (
            <div className="recordings">
              {recordings.map(recording => (
                <div key={recording.id} className="recording-item">
                  <div className="recording-header">
                    <div className="recording-title">
                      <i className="fas fa-video"></i>
                      {recording.name}
                    </div>
                    <div className="recording-actions">
                      <button 
                        onClick={() => exportRecording(recording)}
                        className="export-recording-btn"
                        title="Export recording"
                      >
                        <i className="fas fa-download"></i>
                      </button>
                      <button 
                        onClick={() => deleteRecording(recording.id)}
                        className="delete-recording-btn"
                        title="Delete recording"
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>
                  
                  <div className="recording-details">
                    <div className="recording-stats">
                      <span><i className="fas fa-envelope"></i> {recording.messageCount} messages</span>
                      <span><i className="fas fa-clock"></i> {Math.round((recording.endTime - recording.startTime) / 1000)}s</span>
                      <span><i className="fas fa-tag"></i> {recording.topic}</span>
                    </div>
                    <div className="recording-time">
                      {recording.startTime.toLocaleString()} - {recording.endTime.toLocaleString()}
                    </div>
                  </div>
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