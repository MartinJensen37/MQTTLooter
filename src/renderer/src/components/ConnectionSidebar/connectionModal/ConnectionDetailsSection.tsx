import React from 'react';
import type { ConnectionFormData, FormErrors, FieldChange } from './types';

interface Props {
  formData: ConnectionFormData;
  errors: FormErrors;
  handleInputChange: FieldChange;
  handleProtocolChange: (protocol: string) => void;
  protocolVersionDropdownOpen: boolean;
  setProtocolVersionDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  firstInputRef: React.RefObject<HTMLInputElement>;
}

function ConnectionDetailsSection({
  formData,
  errors,
  handleInputChange,
  handleProtocolChange,
  protocolVersionDropdownOpen,
  setProtocolVersionDropdownOpen,
  firstInputRef,
}: Props) {
  return (
    <div className="mqtt-form-section">
      <h3 className="mqtt-section-title">Connection Details</h3>

      <div className="mqtt-form-group">
        <label htmlFor="name">Connection Name *</label>
        <input
          ref={firstInputRef}
          id="name"
          type="text"
          value={formData.name}
          onChange={(e) => handleInputChange('name', e.target.value)}
          placeholder="My MQTT Broker"
          className={errors.name ? 'error' : ''}
          autoComplete="off"
        />
        {errors.name && <span className="mqtt-error-text">{errors.name}</span>}
      </div>

      <div className="mqtt-form-group">
        <label>Broker Connection</label>
        <div className={`mqtt-broker-url ${errors.hostname || errors.port ? 'error' : ''}`}>
          <select
            value={formData.protocol}
            onChange={(e) => handleProtocolChange(e.target.value)}
            className="mqtt-protocol-select"
          >
            <option value="mqtt">mqtt://</option>
            <option value="mqtts">mqtts://</option>
            <option value="ws">ws://</option>
            <option value="wss">wss://</option>
          </select>

          <input
            type="text"
            value={formData.hostname}
            onChange={(e) => handleInputChange('hostname', e.target.value)}
            placeholder="localhost"
            className="mqtt-hostname"
            autoComplete="off"
          />

          <span className="mqtt-port-separator">:</span>

          <input
            type="number"
            value={formData.port}
            onChange={(e) => handleInputChange('port', parseInt(e.target.value) || '')}
            min="1"
            max="65535"
            className="mqtt-port"
          />
        </div>
        {errors.hostname && <span className="mqtt-error-text">{errors.hostname}</span>}
        {errors.port && <span className="mqtt-error-text">{errors.port}</span>}
      </div>

      {/* WebSocket path — only for ws/wss. */}
      {(formData.protocol === 'ws' || formData.protocol === 'wss') && (
        <div className="mqtt-form-group">
          <label htmlFor="wsPath">WebSocket Path</label>
          <input
            id="wsPath"
            type="text"
            value={formData.wsPath}
            onChange={(e) => handleInputChange('wsPath', e.target.value)}
            placeholder="/mqtt"
            className={errors.wsPath ? 'error' : ''}
            autoComplete="off"
          />
          <div className="mqtt-field-hint">
            Path on the server where WebSocket MQTT is available (e.g., /mqtt, /ws, /websocket)
          </div>
          {errors.wsPath && <span className="mqtt-error-text">{errors.wsPath}</span>}
        </div>
      )}

      <div className="mqtt-form-row">
        <div className="mqtt-form-group">
          <label htmlFor="clientId">Client ID *</label>
          <input
            id="clientId"
            type="text"
            value={formData.clientId}
            onChange={(e) => handleInputChange('clientId', e.target.value)}
            className={errors.clientId ? 'error' : ''}
            autoComplete="off"
          />
          {errors.clientId && <span className="mqtt-error-text">{errors.clientId}</span>}
        </div>

        <div className="mqtt-form-group">
          <label htmlFor="keepalive">Keep Alive (s)</label>
          <input
            id="keepalive"
            type="number"
            value={formData.keepalive}
            onChange={(e) => handleInputChange('keepalive', parseInt(e.target.value))}
            min="1"
            max="65535"
          />
        </div>
      </div>

      <div className="mqtt-form-group">
        <label htmlFor="protocolVersion">MQTT Protocol Version</label>
        <div className="custom-select-wrapper">
          <button
            type="button"
            className="custom-select-button"
            onClick={() => setProtocolVersionDropdownOpen(!protocolVersionDropdownOpen)}
          >
            <span className="select-value">
              {formData.protocolVersion === 5 ? 'MQTT 5.0' : 'MQTT 3.1.1'}
            </span>
            <i className={`fas fa-chevron-down ${protocolVersionDropdownOpen ? 'rotated' : ''}`}></i>
          </button>
          {protocolVersionDropdownOpen && (
            <div className="custom-select-dropdown">
              <button
                type="button"
                className={`dropdown-option ${formData.protocolVersion === 4 ? 'selected' : ''}`}
                onClick={() => {
                  handleInputChange('protocolVersion', 4);
                  setProtocolVersionDropdownOpen(false);
                }}
              >
                MQTT 3.1.1
              </button>
              <button
                type="button"
                className={`dropdown-option ${formData.protocolVersion === 5 ? 'selected' : ''}`}
                onClick={() => {
                  handleInputChange('protocolVersion', 5);
                  setProtocolVersionDropdownOpen(false);
                }}
              >
                MQTT 5.0
              </button>
            </div>
          )}
        </div>
        <div className="mqtt-field-hint">
          {formData.protocolVersion === 5
            ? 'MQTT 5.0 includes enhanced features like user properties, message expiry, and topic aliases'
            : 'MQTT 3.1.1 is the stable, widely-supported version'}
        </div>
      </div>
    </div>
  );
}

export default React.memo(ConnectionDetailsSection);
