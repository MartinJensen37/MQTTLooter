import React from 'react';
import type { ConnectionFormData, FieldChange } from './types';

interface Props {
  formData: ConnectionFormData;
  handleInputChange: FieldChange;
}

function Mqtt5PropertiesSection({ formData, handleInputChange }: Props) {
  return (
    <div className="mqtt-form-section mqtt5-section">
      <h3 className="mqtt-section-title">MQTT 5.0 Properties</h3>

      <div className="mqtt-form-row">
        <div className="mqtt-form-group">
          <label htmlFor="sessionExpiryInterval">Session Expiry Interval (seconds)</label>
          <input
            id="sessionExpiryInterval"
            type="number"
            value={formData.sessionExpiryInterval}
            onChange={(e) =>
              handleInputChange('sessionExpiryInterval', parseInt(e.target.value) || 0)
            }
            min="0"
            placeholder="0"
          />
          <div className="mqtt-field-hint">0: the session ends when the connection closes.</div>
        </div>

        <div className="mqtt-form-group">
          <label htmlFor="receiveMaximum">Receive Maximum</label>
          <input
            id="receiveMaximum"
            type="number"
            value={formData.receiveMaximum}
            onChange={(e) => handleInputChange('receiveMaximum', parseInt(e.target.value) || 65535)}
            min="1"
            max="65535"
            placeholder="65535"
          />
          <div className="mqtt-field-hint">QoS 1 and 2 messages the broker may send at once.</div>
        </div>
      </div>

      <div className="mqtt-form-row">
        <div className="mqtt-form-group">
          <label htmlFor="maximumPacketSize">Maximum Packet Size (bytes)</label>
          <input
            id="maximumPacketSize"
            type="number"
            value={formData.maximumPacketSize}
            onChange={(e) =>
              handleInputChange('maximumPacketSize', parseInt(e.target.value) || 268435455)
            }
            min="1"
            placeholder="268435455"
          />
          <div className="mqtt-field-hint">Largest packet this client accepts, in bytes.</div>
        </div>

        <div className="mqtt-form-group">
          <label htmlFor="topicAliasMaximum">Topic Alias Maximum</label>
          <input
            id="topicAliasMaximum"
            type="number"
            value={formData.topicAliasMaximum}
            onChange={(e) => handleInputChange('topicAliasMaximum', parseInt(e.target.value) || 0)}
            min="0"
            max="65535"
            placeholder="0"
          />
          <div className="mqtt-field-hint">
            Aliases the broker may use for messages to this client. 0: none.
          </div>
        </div>
      </div>

      <div className="mqtt-form-row">
        <div className="mqtt-form-group">
          <label className="mqtt-connection-modal-checkbox-label">
            <input
              type="checkbox"
              checked={formData.requestResponseInformation}
              onChange={(e) => handleInputChange('requestResponseInformation', e.target.checked)}
            />
            <div className="mqtt-connection-modal-checkbox-custom"></div>
            <span className="mqtt-connection-modal-checkbox-text">
              Request Response Information
            </span>
          </label>
          <div className="mqtt-field-hint">Ask the broker for response information.</div>
        </div>

        <div className="mqtt-form-group">
          <label className="mqtt-connection-modal-checkbox-label">
            <input
              type="checkbox"
              checked={formData.requestProblemInformation}
              onChange={(e) => handleInputChange('requestProblemInformation', e.target.checked)}
            />
            <div className="mqtt-connection-modal-checkbox-custom"></div>
            <span className="mqtt-connection-modal-checkbox-text">Request Problem Information</span>
          </label>
          <div className="mqtt-field-hint">
            Ask the broker to explain errors with reason strings.
          </div>
        </div>
      </div>

      <div className="mqtt-form-row">
        <div className="mqtt-form-group">
          <label className="mqtt-connection-modal-checkbox-label">
            <input
              type="checkbox"
              checked={formData.autoAssignTopicAlias}
              onChange={(e) => handleInputChange('autoAssignTopicAlias', e.target.checked)}
            />
            <div className="mqtt-connection-modal-checkbox-custom"></div>
            <span className="mqtt-connection-modal-checkbox-text">
              Use topic aliases when publishing
            </span>
          </label>
          <div className="mqtt-field-hint">
            Shortens repeated topics within the broker's limit. Reset on every reconnect.
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(Mqtt5PropertiesSection);
