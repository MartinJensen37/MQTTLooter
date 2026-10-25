import React from 'react';
import type { ConnectionFormData, FieldChange } from './types';
import InfoTip from '../../Controls/InfoTip';

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
          <label htmlFor="sessionExpiryInterval">
            Session Expiry Interval (seconds){' '}
            <InfoTip text="0: the session ends when the connection closes." />
          </label>
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
        </div>

        <div className="mqtt-form-group">
          <label htmlFor="receiveMaximum">
            Receive Maximum <InfoTip text="QoS 1 and 2 messages the broker may send at once." />
          </label>
          <input
            id="receiveMaximum"
            type="number"
            value={formData.receiveMaximum}
            onChange={(e) => handleInputChange('receiveMaximum', parseInt(e.target.value) || 65535)}
            min="1"
            max="65535"
            placeholder="65535"
          />
        </div>
      </div>

      <div className="mqtt-form-row">
        <div className="mqtt-form-group">
          <label htmlFor="maximumPacketSize">
            Maximum Packet Size (bytes){' '}
            <InfoTip text="Largest packet this client accepts, in bytes." />
          </label>
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
        </div>

        <div className="mqtt-form-group">
          <label htmlFor="topicAliasMaximum">
            Topic Alias Maximum{' '}
            <InfoTip text="Aliases the broker may use for messages to this client. 0: none." />
          </label>
          <input
            id="topicAliasMaximum"
            type="number"
            value={formData.topicAliasMaximum}
            onChange={(e) => handleInputChange('topicAliasMaximum', parseInt(e.target.value) || 0)}
            min="0"
            max="65535"
            placeholder="0"
          />
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
              <InfoTip text="Ask the broker for response information." />
            </span>
          </label>
        </div>

        <div className="mqtt-form-group">
          <label className="mqtt-connection-modal-checkbox-label">
            <input
              type="checkbox"
              checked={formData.requestProblemInformation}
              onChange={(e) => handleInputChange('requestProblemInformation', e.target.checked)}
            />
            <div className="mqtt-connection-modal-checkbox-custom"></div>
            <span className="mqtt-connection-modal-checkbox-text">
              Request Problem Information{' '}
              <InfoTip text="Ask the broker to explain errors with reason strings." />
            </span>
          </label>
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
              <InfoTip text="Shortens repeated topics within the broker's limit. Reset on every reconnect." />
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

export default React.memo(Mqtt5PropertiesSection);
