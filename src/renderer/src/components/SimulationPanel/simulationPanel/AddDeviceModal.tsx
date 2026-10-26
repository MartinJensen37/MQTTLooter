import IntervalField from './IntervalField';
import React, { useState } from 'react';
import { PRESETS, presetOutputs, validateDevice } from './model';
import CloseButton from '../../Controls/CloseButton';

interface Props {
  onClose: () => void;
  onCreateDevice: (data: {
    name: string;
    topic: string;
    publishInterval: number;
    preset: string;
  }) => void;
  selectedTopic?: any;
}

function AddDeviceModal({ onClose, onCreateDevice, selectedTopic }: Props) {
  const [deviceName, setDeviceName] = useState('');
  const [deviceTopic, setDeviceTopic] = useState(selectedTopic?.topicPath || '');
  const [preset, setPreset] = useState('sensor');
  const [interval, setInterval] = useState(1000);
  const errors = validateDevice({
    id: 0,
    name: deviceName,
    topic: deviceTopic,
    publishInterval: interval,
    isPublishing: false,
    outputs: presetOutputs(preset),
    publishMode: 'signals',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (errors.length) return;
    onCreateDevice({
      name: deviceName.trim(),
      topic: deviceTopic,
      publishInterval: interval,
      preset,
    });
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal-content device-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-device-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="modal-header">
          <h3 id="add-device-title">Add Simulated Device</h3>
          <CloseButton onClick={onClose} label="Close device editor" />
        </div>

        <form onSubmit={handleSubmit} className="panel-content device-form">
          <label>
            Start from
            <select
              className="custom-select-button form-select"
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
            >
              {Object.entries(PRESETS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p>
            Signals:{' '}
            {presetOutputs(preset)
              .map((output) => output.name)
              .join(', ')}
          </p>
          <div className="form-group">
            <label htmlFor="sim-device-name">Device Name:</label>
            <input
              id="sim-device-name"
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="e.g. Room sensor"
              className="form-input"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="sim-device-topic">Topic prefix:</label>
            <input
              id="sim-device-topic"
              type="text"
              value={deviceTopic}
              onChange={(e) => setDeviceTopic(e.target.value)}
              placeholder="e.g. sensors/room1"
              className="form-input"
              required
            />
          </div>
          <IntervalField value={interval} onChange={setInterval} />
          {!!deviceName && !!deviceTopic && !!errors.length && <p role="alert">{errors[0]}</p>}
          <div className="form-actions">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-md btn-secondary"
              style={{ borderRadius: 'var(--radius-pill)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!!errors.length}
              className="btn btn-md btn-primary"
              style={{ borderRadius: 'var(--radius-pill)' }}
            >
              Create Device
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default React.memo(AddDeviceModal);
