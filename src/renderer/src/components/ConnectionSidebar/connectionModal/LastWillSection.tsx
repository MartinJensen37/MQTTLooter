import React from 'react';
import type { ConnectionFormData, FormErrors, FieldChange } from './types';

interface Props {
  formData: ConnectionFormData;
  errors: FormErrors;
  handleInputChange: FieldChange;
  willQosDropdownOpen: boolean;
  setWillQosDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

function LastWillSection({
  formData,
  errors,
  handleInputChange,
  willQosDropdownOpen,
  setWillQosDropdownOpen,
}: Props) {
  return (
    <div className="mqtt-form-section">
      <h3 className="mqtt-section-title">Last Will and Testament</h3>

      <div className="mqtt-form-group">
        <label className="mqtt-connection-modal-checkbox-label">
          <input
            type="checkbox"
            checked={formData.willEnabled}
            onChange={(e) => handleInputChange('willEnabled', e.target.checked)}
          />
          <div className="mqtt-connection-modal-checkbox-custom"></div>
          <span className="mqtt-connection-modal-checkbox-text">Enable Last Will Message</span>
        </label>
        <div className="mqtt-field-hint">
          The broker will publish this message if the client disconnects unexpectedly
        </div>
      </div>

      {formData.willEnabled && (
        <>
          <div className="mqtt-form-group">
            <label htmlFor="willTopic">Will Topic *</label>
            <input
              id="willTopic"
              type="text"
              value={formData.willTopic}
              onChange={(e) => handleInputChange('willTopic', e.target.value)}
              placeholder="status/client/offline"
              className={errors.willTopic ? 'error' : ''}
              autoComplete="off"
            />
            {errors.willTopic && <span className="mqtt-error-text">{errors.willTopic}</span>}
          </div>

          <div className="mqtt-form-group">
            <label htmlFor="willMessage">Will Message *</label>
            <input
              id="willMessage"
              type="text"
              value={formData.willMessage}
              onChange={(e) => handleInputChange('willMessage', e.target.value)}
              placeholder="Client disconnected unexpectedly"
              className={errors.willMessage ? 'error' : ''}
              autoComplete="off"
            />
            {errors.willMessage && <span className="mqtt-error-text">{errors.willMessage}</span>}
          </div>

          <div className="mqtt-form-row">
            <div className="mqtt-form-group">
              <label htmlFor="willQos">Will QoS</label>
              <div className="custom-select-wrapper">
                <button
                  type="button"
                  className="custom-select-button"
                  onClick={() => setWillQosDropdownOpen(!willQosDropdownOpen)}
                >
                  <span className="select-value">
                    {formData.willQos === 0
                      ? '0 - At most once'
                      : formData.willQos === 1
                        ? '1 - At least once'
                        : '2 - Exactly once'}
                  </span>
                  <i className={`fas fa-chevron-down ${willQosDropdownOpen ? 'rotated' : ''}`}></i>
                </button>
                {willQosDropdownOpen && (
                  <div className="custom-select-dropdown">
                    <button
                      type="button"
                      className={`dropdown-option ${formData.willQos === 0 ? 'selected' : ''}`}
                      onClick={() => {
                        handleInputChange('willQos', 0);
                        setWillQosDropdownOpen(false);
                      }}
                    >
                      0 - At most once
                    </button>
                    <button
                      type="button"
                      className={`dropdown-option ${formData.willQos === 1 ? 'selected' : ''}`}
                      onClick={() => {
                        handleInputChange('willQos', 1);
                        setWillQosDropdownOpen(false);
                      }}
                    >
                      1 - At least once
                    </button>
                    <button
                      type="button"
                      className={`dropdown-option ${formData.willQos === 2 ? 'selected' : ''}`}
                      onClick={() => {
                        handleInputChange('willQos', 2);
                        setWillQosDropdownOpen(false);
                      }}
                    >
                      2 - Exactly once
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="mqtt-form-group">
              <label>&nbsp;</label>
              <label className="mqtt-connection-modal-checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.willRetain}
                  onChange={(e) => handleInputChange('willRetain', e.target.checked)}
                />
                <div className="mqtt-connection-modal-checkbox-custom"></div>
                <span className="mqtt-connection-modal-checkbox-text">Retain Will Message</span>
              </label>
            </div>
          </div>

          <div className="mqtt-form-row">
            <div className="mqtt-form-group">
              <label htmlFor="willDelayInterval">Will Delay Interval (s)</label>
              <input
                id="willDelayInterval"
                type="number"
                value={formData.willDelayInterval}
                onChange={(e) => handleInputChange('willDelayInterval', parseInt(e.target.value) || 0)}
                min="0"
                placeholder="0"
              />
              <div className="mqtt-field-hint">
                Delay before publishing the will message after disconnect
              </div>
            </div>

            {formData.protocolVersion === 5 && (
              <div className="mqtt-form-group">
                <label htmlFor="willMessageExpiryInterval">Will Message Expiry (s)</label>
                <input
                  id="willMessageExpiryInterval"
                  type="number"
                  value={formData.willMessageExpiryInterval}
                  onChange={(e) =>
                    handleInputChange('willMessageExpiryInterval', parseInt(e.target.value) || 0)
                  }
                  min="0"
                  placeholder="0"
                />
                <div className="mqtt-field-hint">
                  0 = Will message never expires (MQTT 5.0 only)
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default React.memo(LastWillSection);
