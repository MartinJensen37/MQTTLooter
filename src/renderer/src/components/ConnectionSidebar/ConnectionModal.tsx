import React, { useState, useEffect, useRef } from 'react';
import './ConnectionModal.css';
import type { ConnectionFormData, FormErrors, CertFileType } from './connectionModal/types';
import { buildBrokerUrl, buildInitialFormData, createDefaultFormData } from './connectionModal/formHelpers';
import ConnectionDetailsSection from './connectionModal/ConnectionDetailsSection';
import Mqtt5PropertiesSection from './connectionModal/Mqtt5PropertiesSection';
import TlsSection from './connectionModal/TlsSection';
import LastWillSection from './connectionModal/LastWillSection';
import SubscriptionsSection from './connectionModal/SubscriptionsSection';

interface ConnectionModalProps {
  connection: any;
  onSave: (data: any) => void;
  onCancel: () => void;
}

function ConnectionModal({ connection, onSave, onCancel }: ConnectionModalProps) {
  const [formData, setFormData] = useState<ConnectionFormData>(createDefaultFormData);
  const [errors, setErrors] = useState<FormErrors>({});
  const [protocolVersionDropdownOpen, setProtocolVersionDropdownOpen] = useState(false);
  const [willQosDropdownOpen, setWillQosDropdownOpen] = useState(false);
  const [subscriptionQosDropdowns, setSubscriptionQosDropdowns] = useState<Record<number, boolean>>(
    {},
  );
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Seed the form from the connection being edited (or defaults for a new one).
  useEffect(() => {
    setFormData(buildInitialFormData(connection));
    setErrors({});
  }, [connection]);

  // Focus the first field shortly after mount.
  useEffect(() => {
    const timer = setTimeout(() => firstInputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const toggleSubscriptionQosDropdown = (index: number) => {
    setSubscriptionQosDropdowns((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleProtocolChange = (protocol: string) => {
    let defaultPort = 1883;
    let defaultWsPath = '/mqtt';

    switch (protocol) {
      case 'mqtt':
        defaultPort = 1883;
        defaultWsPath = '';
        break;
      case 'mqtts':
        defaultPort = 8883;
        defaultWsPath = '';
        break;
      case 'ws':
        defaultPort = 8000;
        defaultWsPath = '/mqtt';
        break;
      case 'wss':
        defaultPort = 443;
        defaultWsPath = '/mqtt';
        break;
      default:
        defaultPort = 1883;
        defaultWsPath = '';
    }

    setFormData((prev) => ({ ...prev, protocol, port: defaultPort, wsPath: defaultWsPath }));
    if (errors.protocol) {
      setErrors((prev) => ({ ...prev, protocol: null }));
    }
  };

  const handleInputChange = (field: keyof ConnectionFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const handleSubscriptionChange = (
    index: number,
    field: 'topic' | 'qos',
    value: string | number,
  ) => {
    const newSubscriptions = [...formData.subscriptions];
    newSubscriptions[index] = {
      ...newSubscriptions[index],
      [field]: field === 'qos' ? parseInt(String(value)) : value,
    };
    setFormData((prev) => ({ ...prev, subscriptions: newSubscriptions }));
  };

  const addSubscription = () => {
    setFormData((prev) => ({
      ...prev,
      subscriptions: [...prev.subscriptions, { topic: '', qos: 0 }],
    }));
  };

  const removeSubscription = (index: number) => {
    if (formData.subscriptions.length > 1) {
      setFormData((prev) => ({
        ...prev,
        subscriptions: prev.subscriptions.filter((_, i) => i !== index),
      }));
    }
  };

  const validateForm = () => {
    const newErrors: FormErrors = {};

    if (!formData.name.trim()) newErrors.name = 'Connection name is required';
    if (!formData.hostname.trim()) newErrors.hostname = 'Hostname is required';
    if (!formData.port || Number(formData.port) < 1 || Number(formData.port) > 65535) {
      newErrors.port = 'Port must be between 1 and 65535';
    }
    if (!formData.clientId.trim()) newErrors.clientId = 'Client ID is required';

    if (formData.protocol === 'ws' || formData.protocol === 'wss') {
      if (!formData.wsPath.trim()) {
        newErrors.wsPath = 'WebSocket path is required for WebSocket connections';
      } else if (!formData.wsPath.startsWith('/')) {
        newErrors.wsPath = 'WebSocket path must start with /';
      }
    }

    if (formData.willEnabled) {
      if (!formData.willTopic.trim()) {
        newErrors.willTopic = 'Will topic is required when Last Will is enabled';
      }
      if (!formData.willMessage.trim()) {
        newErrors.willMessage = 'Will message is required when Last Will is enabled';
      }
    }

    formData.subscriptions.forEach((sub, index) => {
      if (!sub.topic.trim()) newErrors[`subscription_${index}`] = 'Topic is required';
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    const brokerUrl = buildBrokerUrl(
      formData.protocol,
      formData.hostname,
      formData.port,
      formData.wsPath,
    );
    const finalFormData: any = {
      ...formData,
      brokerUrl,
      ...(formData.protocolVersion === 5 && {
        sessionExpiryInterval: formData.sessionExpiryInterval,
        receiveMaximum: formData.receiveMaximum,
        maximumPacketSize: formData.maximumPacketSize,
        topicAliasMaximum: formData.topicAliasMaximum,
        requestResponseInformation: formData.requestResponseInformation,
        requestProblemInformation: formData.requestProblemInformation,
        userProperties: formData.userProperties,
      }),
    };

    delete finalFormData.protocol;
    delete finalFormData.hostname;
    delete finalFormData.port;
    // wsPath is kept for the connection manager.

    onSave(finalFormData);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  const handleFileSelect = async (
    fileType: CertFileType,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const fileContent = await file.text();
      setFormData((prev) => ({
        ...prev,
        tls: {
          ...prev.tls,
          [fileType]: {
            name: file.name,
            content: fileContent,
            size: file.size,
            lastModified: file.lastModified,
          },
        },
      }));
    } catch (error) {
      console.error(`Error reading ${fileType} file:`, error);
      alert(`Failed to read ${fileType} file`);
    }
  };

  const clearCertificateFile = (fileType: CertFileType) => {
    setFormData((prev) => ({ ...prev, tls: { ...prev.tls, [fileType]: null } }));
  };

  return (
    <div className="mqtt-modal-overlay" onClick={handleOverlayClick}>
      <div className="mqtt-modal-container">
        <div className="mqtt-modal-header">
          <h2>{connection ? 'Edit Connection' : 'New Connection'}</h2>
          <button className="modal-close-btn" onClick={onCancel} type="button">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mqtt-modal-form">
          <div className="mqtt-modal-content">
            <ConnectionDetailsSection
              formData={formData}
              errors={errors}
              handleInputChange={handleInputChange}
              handleProtocolChange={handleProtocolChange}
              protocolVersionDropdownOpen={protocolVersionDropdownOpen}
              setProtocolVersionDropdownOpen={setProtocolVersionDropdownOpen}
              firstInputRef={firstInputRef}
            />

            {formData.protocolVersion === 5 && (
              <Mqtt5PropertiesSection formData={formData} handleInputChange={handleInputChange} />
            )}

            {/* Authentication */}
            <div className="mqtt-form-section">
              <h3 className="mqtt-section-title">Authentication</h3>
              <div className="mqtt-form-row">
                <div className="mqtt-form-group">
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    type="text"
                    value={formData.username}
                    onChange={(e) => handleInputChange('username', e.target.value)}
                    placeholder="Optional"
                    autoComplete="username"
                  />
                </div>
                <div className="mqtt-form-group">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    placeholder="Optional"
                    autoComplete="current-password"
                  />
                </div>
              </div>
            </div>

            <TlsSection
              formData={formData}
              handleInputChange={handleInputChange}
              handleFileSelect={handleFileSelect}
              clearCertificateFile={clearCertificateFile}
            />

            <LastWillSection
              formData={formData}
              errors={errors}
              handleInputChange={handleInputChange}
              willQosDropdownOpen={willQosDropdownOpen}
              setWillQosDropdownOpen={setWillQosDropdownOpen}
            />

            {/* Other Options */}
            <div className="mqtt-form-section">
              <h3 className="mqtt-section-title">Other Options</h3>
              <div className="mqtt-form-group">
                <label className="mqtt-connection-modal-checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.clean}
                    onChange={(e) => handleInputChange('clean', e.target.checked)}
                  />
                  <div className="mqtt-connection-modal-checkbox-custom"></div>
                  <span className="mqtt-connection-modal-checkbox-text">
                    Clean Session
                    {formData.protocolVersion === 5 && (
                      <span className="mqtt5-note"> (Clean Start in MQTT 5.0)</span>
                    )}
                  </span>
                </label>
              </div>
            </div>

            <SubscriptionsSection
              formData={formData}
              errors={errors}
              handleSubscriptionChange={handleSubscriptionChange}
              addSubscription={addSubscription}
              removeSubscription={removeSubscription}
              subscriptionQosDropdowns={subscriptionQosDropdowns}
              toggleSubscriptionQosDropdown={toggleSubscriptionQosDropdown}
            />
          </div>

          <div className="mqtt-modal-footer">
            <button type="button" onClick={onCancel} className="mqtt-cancel-btn">
              Cancel
            </button>
            <button type="submit" className="mqtt-save-btn">
              {connection ? 'Update' : 'Create'} Connection
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ConnectionModal;
