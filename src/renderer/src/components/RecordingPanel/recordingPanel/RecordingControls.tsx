import React from 'react';
import { clockTime } from '../../../utils/time';

interface Props {
  isRecording: boolean;
  isRecordingDisabled: boolean;
  storageReady?: boolean;
  recordingStart: Date | null;
  messageCount: number;
  topicCount: number;
  dropped?: number;
  otherRecordings?: number;
  busy?: boolean;
  startRecording: () => void;
  stopRecording: () => void;
}

function RecordingControls({
  isRecording,
  isRecordingDisabled,
  storageReady = true,
  recordingStart,
  messageCount,
  topicCount,
  dropped = 0,
  otherRecordings = 0,
  busy = false,
  startRecording,
  stopRecording,
}: Props) {
  return (
    <div className="recording-fixed-controls">
      {isRecordingDisabled && storageReady && (
        <p
          className="recording-connection-warning"
          role="status"
          title="Connect to a broker to record. Saved recordings can still be played."
        >
          <i className="fas fa-plug"></i> No active connection
        </p>
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
              : !storageReady
                ? 'Storage unavailable'
                : isRecordingDisabled
                  ? 'Connection Required'
                  : 'Ready to Record'}
          </div>
          {isRecording && (
            <div className="recording-live-info">
              <span>Started: {recordingStart ? clockTime(recordingStart.getTime()) : ''}</span>
              <span>Messages: {messageCount}</span>
              <span>Topics: {topicCount}</span>
              {dropped > 0 && <span>Not recorded: {dropped}</span>}
            </div>
          )}
          {otherRecordings > 0 && (
            <div className="recording-live-info">
              Also recording {otherRecordings} other{' '}
              {otherRecordings === 1 ? 'connection' : 'connections'}
            </div>
          )}
        </div>
        <div className="recording-action-buttons">
          {!isRecording ? (
            <button
              onClick={startRecording}
              className="btn btn-lg btn-success"
              disabled={isRecordingDisabled || busy}
              title={
                !storageReady
                  ? 'Wait for recording storage to load'
                  : isRecordingDisabled
                    ? 'Connect to an MQTT broker to start recording'
                    : 'Start recording messages'
              }
            >
              <i className="fas fa-record-vinyl"></i> Record
            </button>
          ) : (
            <button onClick={stopRecording} className="btn btn-lg btn-danger" disabled={busy}>
              <i className="fas fa-stop"></i> Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(RecordingControls);
