import React, { useState } from 'react';

interface Props {
  onClose: () => void;
  onCreateDevice: (data: { name: string; topic: string; publishInterval: number }) => void;
  selectedTopic?: any;
}

function AddDeviceModal({ onClose, onCreateDevice, selectedTopic }: Props) {
  const [deviceName, setDeviceName] = useState('');
  const [deviceTopic, setDeviceTopic] = useState(selectedTopic?.topicPath || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName.trim() || !deviceTopic.trim()) return;
    onCreateDevice({
      name: deviceName.trim(),
      topic: deviceTopic.trim(),
      publishInterval: 5000,
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Add Simulated Device</h3>
          <button onClick={onClose} className="modal-close-btn">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="panel-content device-form">
          <div className="form-group">
            <label>Device Name:</label>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Temperature Sensor"
              className="form-input"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>MQTT Topic:</label>
            <input
              type="text"
              value={deviceTopic}
              onChange={(e) => setDeviceTopic(e.target.value)}
              placeholder="sensors/room/temperature"
              className="form-input"
              required
            />
          </div>

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
