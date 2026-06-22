import React from 'react';
import type { RecordedMessage } from './types';

interface Props {
  isRecording: boolean;
  isRecordingDisabled: boolean;
  recordingStart: Date | null;
  recordedMessages: RecordedMessage[];
  startRecording: () => void;
  stopRecording: () => void;
}

function RecordingControls({
  isRecording,
  isRecordingDisabled,
  recordingStart,
  recordedMessages,
  startRecording,
  stopRecording,
}: Props) {
  return (
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

      <div
        className={`recording-controls-section ${isRecordingDisabled ? 'recording-controls-disabled' : ''}`}
      >
        <div className="recording-status-area">
          <div
            className={`recording-status-indicator ${isRecording ? 'recording-active' : 'recording-stopped'} ${isRecordingDisabled ? 'recording-indicator-disabled' : ''}`}
          >
            <i className={`fas fa-${isRecording ? 'circle' : 'stop-circle'}`}></i>
            {isRecording
              ? 'Recording...'
              : isRecordingDisabled
                ? 'Connection Required'
                : 'Ready to Record'}
          </div>
          {isRecording && (
            <div className="recording-live-info">
              <span>Started: {recordingStart?.toLocaleTimeString()}</span>
              <span>Messages: {recordedMessages.length}</span>
              <span>Topics: {[...new Set(recordedMessages.map((msg) => msg.topic))].length}</span>
            </div>
          )}
        </div>
        <div className="recording-action-buttons">
          {!isRecording ? (
            <button
              onClick={startRecording}
              className="btn btn-lg btn-success"
              disabled={isRecordingDisabled}
              title={
                isRecordingDisabled
                  ? 'Connect to an MQTT broker to start recording'
                  : 'Start recording messages'
              }
            >
              <i className="fas fa-record-vinyl"></i> Record
            </button>
          ) : (
            <button onClick={stopRecording} className="btn btn-lg btn-danger">
              <i className="fas fa-stop"></i> Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(RecordingControls);
