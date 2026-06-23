import React, { useState } from 'react';
import type { SimulatedDevice, DeviceOutput } from './types';
import { formatOutputValue } from './formatters';

interface Props {
  device: SimulatedDevice;
  onUpdateDevice: (deviceId: number, updates: any) => void;
  onPublishOnce: (deviceId: number) => void;
  onTogglePublishing: (deviceId: number) => void;
  onAddOutput: (deviceId: number) => void;
  onRemoveOutput: (deviceId: number, outputId: number) => void;
  isConnected: boolean;
  onEditOutput: (output: DeviceOutput) => void;
}

function DeviceConfigPanel({
  device,
  onUpdateDevice,
  onPublishOnce,
  onTogglePublishing,
  onAddOutput,
  onRemoveOutput,
  isConnected,
  onEditOutput,
}: Props) {
  const [intervalDropdownOpen, setIntervalDropdownOpen] = useState(false);

  const handleEditOutput = (output: DeviceOutput) => {
    if (device.isPublishing) {
      onTogglePublishing(device.id);
    }
    onEditOutput(output);
  };

  return (
    <div className="device-config panel">
      <div className="device-config-header">
        <h3>{device.name}</h3>
        <div className="device-status">
          <span className={`status-indicator ${device.isPublishing ? 'publishing' : 'stopped'}`}>
            <i className={`fas fa-${device.isPublishing ? 'broadcast-tower' : 'stop-circle'}`}></i>
            {device.isPublishing ? 'Publishing' : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Outputs */}
      <div className="outputs-section">
        <div className="section-header">
          <h4>
            <i className="fas fa-box"></i> Outputs
          </h4>
          <button
            onClick={() => onAddOutput(device.id)}
            className="btn btn-sm btn-success"
            title="Add Output"
            style={{ borderRadius: 'var(--radius-pill)' }}
          >
            <i className="fas fa-plus"></i>
          </button>
        </div>

        <div className="outputs-list">
          {device.outputs.map((output) => (
            <div key={output.id} className="output-item">
              <div className="output-info">
                <span className="output-name">{output.name}:</span>
                <span className="output-value">{formatOutputValue(output)}</span>
                <span className="output-type">{output.dataType}</span>
                {output.includeTimestamp !== false && (
                  <span className="timestamp-indicator" title="Includes timestamp">
                    <i className="fas fa-clock"></i>
                  </span>
                )}
              </div>
              <div className="output-actions">
                <button
                  onClick={() => handleEditOutput(output)}
                  className="btn btn-sm btn-secondary"
                  title="Edit output"
                  style={{ borderRadius: 'var(--radius-pill)' }}
                >
                  <i className="fas fa-edit"></i>
                </button>
                <button
                  onClick={() => onRemoveOutput(device.id, output.id)}
                  className="btn btn-sm btn-danger"
                  title="Remove output"
                  disabled={device.outputs.length <= 1}
                  style={{ borderRadius: 'var(--radius-pill)' }}
                >
                  <i className="fas fa-trash"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Publishing controls */}
      <div className="publishing-controls">
        <div className="interval-control">
          <label>
            <i className="fas fa-clock"></i> Publish Interval:
          </label>
          <div className="custom-select-wrapper">
            <button
              type="button"
              className="custom-select-button"
              onClick={() => setIntervalDropdownOpen(!intervalDropdownOpen)}
            >
              <span className="select-value">
                {device.publishInterval === 1000
                  ? '1s'
                  : device.publishInterval === 2000
                    ? '2s'
                    : device.publishInterval === 5000
                      ? '5s'
                      : device.publishInterval === 10000
                        ? '10s'
                        : device.publishInterval === 30000
                          ? '30s'
                          : device.publishInterval === 60000
                            ? '1m'
                            : '5s'}
              </span>
              <i className={`fas fa-chevron-down ${intervalDropdownOpen ? 'rotated' : ''}`}></i>
            </button>
            {intervalDropdownOpen && (
              <div className="custom-select-dropdown">
                {[
                  { ms: 1000, label: '1s' },
                  { ms: 2000, label: '2s' },
                  { ms: 5000, label: '5s' },
                  { ms: 10000, label: '10s' },
                  { ms: 30000, label: '30s' },
                  { ms: 60000, label: '1m' },
                ].map(({ ms, label }) => (
                  <button
                    key={ms}
                    type="button"
                    className={`dropdown-option ${device.publishInterval === ms ? 'selected' : ''}`}
                    onClick={() => {
                      onUpdateDevice(device.id, { publishInterval: ms });
                      setIntervalDropdownOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="publishing-buttons">
          <button
            onClick={() => onTogglePublishing(device.id)}
            className={`btn btn-md ${device.isPublishing ? 'btn-danger stop' : 'btn-success start'}`}
            disabled={!isConnected}
            style={{ borderRadius: 'var(--radius-pill)' }}
          >
            <i className={`fas fa-${device.isPublishing ? 'stop' : 'play'}`}></i>
            {device.isPublishing ? 'Stop Loop' : 'Start Loop'}
          </button>

          <button
            onClick={() => onPublishOnce(device.id)}
            className="btn btn-md btn-primary"
            disabled={!isConnected}
            style={{ borderRadius: 'var(--radius-pill)' }}
          >
            <i className="fas fa-paper-plane"></i>
            Publish Once
          </button>
        </div>
      </div>

      {/* Topic */}
      <div className="form-group topic-section">
        <label>
          <i className="fas fa-tag"></i> MQTT Topic:
        </label>
        <input
          type="text"
          value={device.topic}
          onChange={(e) => onUpdateDevice(device.id, { topic: e.target.value })}
          placeholder="sensors/room/temperature"
          className="form-input topic-input"
        />
      </div>

      {!isConnected && (
        <div className="badge badge-warning connection-warning">
          <i className="fas fa-exclamation-triangle"></i>
          Connection not active. Publishing is disabled.
        </div>
      )}
    </div>
  );
}

export default React.memo(DeviceConfigPanel);
