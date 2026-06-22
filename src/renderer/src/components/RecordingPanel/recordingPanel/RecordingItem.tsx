import React from 'react';
import type { Recording } from './types';
import { getUniqueTopics } from './recordingHelpers';

interface Props {
  recording: Recording;
  isExpanded: boolean;
  editingRecording: number | null;
  editingName: string;
  setEditingName: React.Dispatch<React.SetStateAction<string>>;
  onSelect: (recording: Recording) => void;
  startEditingRecording: (recording: Recording, e: React.MouseEvent) => void;
  saveRecordingName: (recordingId: number) => void;
  handleNameKeyPress: (e: React.KeyboardEvent, recordingId: number) => void;
  saveRecordingToFile: (recording: Recording) => void;
  deleteRecording: (recordingId: number) => void;
  expandedContent: React.ReactNode;
}

function RecordingItem({
  recording,
  isExpanded,
  editingRecording,
  editingName,
  setEditingName,
  onSelect,
  startEditingRecording,
  saveRecordingName,
  handleNameKeyPress,
  saveRecordingToFile,
  deleteRecording,
  expandedContent,
}: Props) {
  const topicCount = getUniqueTopics(recording.messages).length;

  return (
    <div className={`recording-saved-item ${isExpanded ? 'recording-item-expanded' : ''}`}>
      {/* Header */}
      <div className="recording-item-header" onClick={() => onSelect(recording)}>
        <div className="recording-item-title">
          <i className={`fas fa-${isExpanded ? 'chevron-down' : 'chevron-right'}`}></i>
          <i className="fas fa-video"></i>
          {editingRecording === recording.id ? (
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => saveRecordingName(recording.id)}
              onKeyDown={(e) => handleNameKeyPress(e, recording.id)}
              onClick={(e) => e.stopPropagation()}
              className="form-input recording-name-input"
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
            className="btn btn-sm"
            title="Rename recording"
          >
            <i className="fas fa-edit"></i>
          </button>
          <button
            onClick={() => saveRecordingToFile(recording)}
            className="btn btn-sm btn-primary"
            title="Save recording to file"
          >
            <i className="fas fa-save"></i>
          </button>
          <button
            onClick={() => deleteRecording(recording.id)}
            className="btn btn-sm btn-danger"
            title="Delete recording"
          >
            <i className="fas fa-trash"></i>
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="recording-item-summary">
        <div className="recording-item-stats">
          <span>
            <i className="fas fa-envelope"></i> {recording.messageCount} messages
          </span>
          <span>
            <i className="fas fa-clock"></i>{' '}
            {Math.round((recording.endTime.getTime() - recording.startTime.getTime()) / 1000)}s
          </span>
          <span>
            <i className="fas fa-tag"></i> {topicCount} {topicCount === 1 ? 'topic' : 'topics'}
          </span>
        </div>
        <div className="recording-item-time">
          {recording.startTime.toLocaleString()} - {recording.endTime.toLocaleString()}
        </div>
      </div>

      {/* Expanded playback area (supplied by the container) */}
      {expandedContent}
    </div>
  );
}

export default React.memo(RecordingItem);
