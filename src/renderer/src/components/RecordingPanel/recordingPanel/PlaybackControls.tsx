import React from 'react';
import type { CurrentPlayback } from './types';
import { getUniqueTopics, formatPayload } from './recordingHelpers';

interface Props {
  currentPlayback: CurrentPlayback;
  currentIndex: number;
  isPlaying: boolean;
  isPaused: boolean;
  playbackSpeed: number;
  setPlaybackSpeed: React.Dispatch<React.SetStateAction<number>>;
  stepSize: number;
  setStepSize: React.Dispatch<React.SetStateAction<number>>;
  selectedTopicsFilter: string[];
  setSelectedTopicsFilter: React.Dispatch<React.SetStateAction<string[]>>;
  showTopicFilter: boolean;
  setShowTopicFilter: React.Dispatch<React.SetStateAction<boolean>>;
  isRecordingDisabled: boolean;
  clearTopicFilter: () => void;
  toggleTopicFilter: (topic: string) => void;
  stepBackward: (e?: React.MouseEvent) => void;
  resetPlayback: () => void;
  resumePlayback: () => void;
  startRealtimePlayback: () => void;
  pausePlayback: () => void;
  stepForward: (e?: React.MouseEvent) => void;
}

function PlaybackControls({
  currentPlayback,
  currentIndex,
  isPlaying,
  isPaused,
  playbackSpeed,
  setPlaybackSpeed,
  stepSize,
  setStepSize,
  selectedTopicsFilter,
  setSelectedTopicsFilter,
  showTopicFilter,
  setShowTopicFilter,
  isRecordingDisabled,
  clearTopicFilter,
  toggleTopicFilter,
  stepBackward,
  resetPlayback,
  resumePlayback,
  startRealtimePlayback,
  pausePlayback,
  stepForward,
}: Props) {
  const currentMessage = currentPlayback.messages[currentIndex] || null;

  return (
    <div className="recording-expanded-area">
      {isRecordingDisabled && (
        <div className="recording-playback-warning">
          <i className="fas fa-exclamation-triangle"></i>
          <strong>Note:</strong> Connect to an MQTT broker to publish messages during playback.
        </div>
      )}

      {/* Topic filter */}
      <div className="recording-topic-filter-section">
        <button onClick={() => setShowTopicFilter(!showTopicFilter)} className="btn btn-md btn-secondary">
          <i className="fas fa-filter"></i> Topic Filter ({selectedTopicsFilter.length} of{' '}
          {getUniqueTopics(currentPlayback.originalMessages).length} selected)
        </button>
        {showTopicFilter && (
          <div className="recording-topic-filter-panel">
            <div className="recording-filter-actions">
              <button
                onClick={() => setSelectedTopicsFilter(getUniqueTopics(currentPlayback.originalMessages))}
                className="btn btn-sm btn-success"
              >
                Select All
              </button>
              <button onClick={clearTopicFilter} className="btn btn-sm btn-secondary">
                Clear All
              </button>
            </div>
            <div className="recording-topic-list">
              {getUniqueTopics(currentPlayback.originalMessages).map((topic) => (
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
              Filtered messages: {currentPlayback.messages.length} of{' '}
              {currentPlayback.originalMessages.length}
            </div>
          </div>
        )}
      </div>

      {/* Playback controls */}
      <div className="recording-playback-section">
        {/* Progress bar */}
        <div className="recording-playback-progress">
          <div className="recording-progress-bar">
            <div
              className="recording-progress-fill"
              style={{
                width: `${currentPlayback.messages.length === 0 ? 0 : (currentIndex / currentPlayback.messages.length) * 100}%`,
              }}
            ></div>
          </div>
          <span>
            {currentPlayback.messages.length === 0
              ? 0
              : Math.round((currentIndex / currentPlayback.messages.length) * 100)}
            %
          </span>
        </div>

        {/* Main controls */}
        <div className="recording-main-controls">
          <button onClick={stepBackward} className="btn btn-md" disabled={currentIndex === 0}>
            <i className="fas fa-step-backward"></i>
          </button>

          <button onClick={resetPlayback} className="btn btn-md btn-secondary" title="Reset to beginning">
            <i className="fas fa-undo"></i>
          </button>

          {!isPlaying ? (
            <button
              onClick={isPaused ? resumePlayback : startRealtimePlayback}
              className="btn btn-lg btn-success"
              title={
                isRecordingDisabled
                  ? 'Playback will not publish messages (no connection)'
                  : 'Start playback'
              }
            >
              <i className="fas fa-play"></i>
            </button>
          ) : (
            <button onClick={pausePlayback} className="btn btn-lg btn-warning">
              <i className="fas fa-pause"></i>
            </button>
          )}

          <button
            onClick={stepForward}
            className="btn btn-md"
            disabled={currentIndex >= currentPlayback.messages.length}
          >
            <i className="fas fa-step-forward"></i>
          </button>
        </div>

        {/* Settings row */}
        <div className="recording-playback-settings">
          <div className="recording-speed-control">
            <label>Speed: </label>
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              className="form-input"
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
              className="form-input"
            >
              <option value={1}>1 msg</option>
              <option value={5}>5 msgs</option>
              <option value={10}>10 msgs</option>
              <option value={15}>15 msgs</option>
              <option value={20}>20 msgs</option>
            </select>
          </div>
        </div>

        {/* Current message info */}
        {currentMessage && (
          <div className="recording-current-message-info">
            <div className="recording-message-position">
              <strong>Position:</strong>
              <span>
                Message {currentIndex + 1} of {currentPlayback.messages.length}
              </span>
            </div>
            <div className="recording-message-details">
              <div>
                <strong>Topic:</strong>
                <span>{currentMessage.topic}</span>
              </div>
              <div>
                <strong>Time:</strong>
                <span>{new Date(currentMessage.timestamp).toLocaleTimeString()}</span>
              </div>
              <div>
                <strong>QoS:</strong>
                <span>{currentMessage.qos || 0}</span>
              </div>
              <div>
                <strong>Retain:</strong>
                <span>{currentMessage.retain ? 'Yes' : 'No'}</span>
              </div>
            </div>
            <div className="recording-message-payload">
              <strong>Payload:</strong>
              <pre className="recording-payload-content">
                {formatPayload(currentMessage.message || '')}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(PlaybackControls);
