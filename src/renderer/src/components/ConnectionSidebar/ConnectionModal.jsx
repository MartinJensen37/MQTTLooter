import React, { useState, useEffect, useRef } from 'react';
import './ConnectionModal.css'; // Make sure this import is here

function ConnectionModal({ connection, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    name: '',
    protocol: 'mqtt',
    hostname: 'localhost',
    port: 1883,
    clientId: `mqttlooter_${Date.now()}`,
    username: '',
    password: '',
    clean: true,
    keepalive: 60,
    reconnectPeriod: 1000,
    connectTimeout: 30000,
    subscriptions: [
      { topic: '#', qos: 0 }
    ]
  });

  const [errors, setErrors] = useState({});
  const firstInputRef = useRef(null);
  const modalContentRef = useRef(null);

  // Parse broker URL into components
  const parseBrokerUrl = (url) => {
    try {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol.replace(':', '');
      const hostname = urlObj.hostname;
      const port = parseInt(urlObj.port) || (protocol === 'mqtt' ? 1883 : protocol === 'mqtts' ? 8883 : protocol === 'ws' ? 80 : 443);
      
      return { protocol, hostname, port };
    } catch (error) {
      // Fallback for invalid URLs
      return { protocol: 'mqtt', hostname: 'localhost', port: 1883 };
    }
  };

  // Build broker URL from components
  const buildBrokerUrl = (protocol, hostname, port) => {
    return `${protocol}://${hostname}:${port}`;
  };

  // Initialize form data when connection changes
  useEffect(() => {
    if (connection?.config) {
      let protocol = 'mqtt';
      let hostname = 'localhost';
      let port = 1883;

      // Parse existing broker URL if available
      if (connection.config.brokerUrl) {
        const parsed = parseBrokerUrl(connection.config.brokerUrl);
        protocol = parsed.protocol;
        hostname = parsed.hostname;
        port = parsed.port;
      }

      setFormData({
        name: connection.config.name || '',
        protocol,
        hostname,
        port,
        clientId: connection.config.clientId || `mqttlooter_${Date.now()}`,
        username: connection.config.username || '',
        password: connection.config.password || '',
        clean: connection.config.clean !== undefined ? connection.config.clean : true,
        keepalive: connection.config.keepalive || 60,
        reconnectPeriod: connection.config.reconnectPeriod || 1000,
        connectTimeout: connection.config.connectTimeout || 30000,
        subscriptions: connection.config.subscriptions || [{ topic: '#', qos: 0 }]
      });
    } else {
      // Reset to defaults for new connection
      setFormData({
        name: '',
        protocol: 'mqtt',
        hostname: 'localhost',
        port: 1883,
        clientId: `mqttlooter_${Date.now()}`,
        username: '',
        password: '',
        clean: true,
        keepalive: 60,
        reconnectPeriod: 1000,
        connectTimeout: 30000,
        subscriptions: [{ topic: '#', qos: 0 }]
      });
    }
    // Clear any existing errors
    setErrors({});
  }, [connection]);

  // Focus management
  useEffect(() => {
    // Small delay to ensure modal is fully rendered
    const timer = setTimeout(() => {
      if (firstInputRef.current) {
        firstInputRef.current.focus();
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Update port when protocol changes
  const handleProtocolChange = (protocol) => {
    let defaultPort = 1883;
    switch (protocol) {
      case 'mqtt':
        defaultPort = 1883;
        break;
      case 'mqtts':
        defaultPort = 8883;
        break;
      case 'ws':
        defaultPort = 80;
        break;
      case 'wss':
        defaultPort = 443;
        break;
      default:
        defaultPort = 1883;
    }

    setFormData(prev => ({
      ...prev,
      protocol,
      port: defaultPort
    }));

    // Clear protocol-related errors
    if (errors.protocol) {
      setErrors(prev => ({
        ...prev,
        protocol: null
      }));
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: null
      }));
    }
  };

  const handleSubscriptionChange = (index, field, value) => {
    const newSubscriptions = [...formData.subscriptions];
    newSubscriptions[index] = {
      ...newSubscriptions[index],
      [field]: field === 'qos' ? parseInt(value) : value
    };
    setFormData(prev => ({
      ...prev,
      subscriptions: newSubscriptions
    }));
  };

  const addSubscription = () => {
    setFormData(prev => ({
      ...prev,
      subscriptions: [...prev.subscriptions, { topic: '', qos: 0 }]
    }));

    // Auto-scroll to bottom after adding new subscription
    setTimeout(() => {
      if (modalContentRef.current) {
        modalContentRef.current.scrollTop = modalContentRef.current.scrollHeight;
      }
    }, 100);
  };

  const removeSubscription = (index) => {
    if (formData.subscriptions.length > 1) {
      setFormData(prev => ({
        ...prev,
        subscriptions: prev.subscriptions.filter((_, i) => i !== index)
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Connection name is required';
    }

    if (!formData.hostname.trim()) {
      newErrors.hostname = 'Hostname is required';
    }

    if (!formData.port || formData.port < 1 || formData.port > 65535) {
      newErrors.port = 'Port must be between 1 and 65535';
    }

    if (!formData.clientId.trim()) {
      newErrors.clientId = 'Client ID is required';
    }

    // Validate subscriptions
    formData.subscriptions.forEach((sub, index) => {
      if (!sub.topic.trim()) {
        newErrors[`subscription_${index}`] = 'Topic is required';
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validateForm()) {
      // Build the broker URL from components
      const brokerUrl = buildBrokerUrl(formData.protocol, formData.hostname, formData.port);
      
      // Create the final form data with brokerUrl
      const finalFormData = {
        ...formData,
        brokerUrl
      };
      
      // Remove the individual URL components from the final data
      delete finalFormData.protocol;
      delete finalFormData.hostname;
      delete finalFormData.port;
      
      onSave(finalFormData);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="connection-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{connection ? 'Edit Connection' : 'New Connection'}</h2>
          <button className="close-btn" onClick={onCancel} type="button">×</button>
        </div>

        <div className="modal-content" ref={modalContentRef}>
          <form onSubmit={handleSubmit}>
            <div className="form-section">
              <h3>Connection Details</h3>
              
              <div className="form-group">
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
                {errors.name && <span className="error-text">{errors.name}</span>}
              </div>

              <div className="form-group">
                <label>Broker Connection</label>
                <div className={`broker-url-row ${(errors.hostname || errors.port) ? 'error' : ''}`}>
                  <div className="protocol-group">
                    <select
                      value={formData.protocol}
                      onChange={(e) => handleProtocolChange(e.target.value)}
                    >
                      <option value="mqtt">mqtt://</option>
                      <option value="mqtts">mqtts://</option>
                      <option value="ws">ws://</option>
                      <option value="wss">wss://</option>
                    </select>
                  </div>
                  
                  <div className="hostname-group">
                    <input
                      type="text"
                      value={formData.hostname}
                      onChange={(e) => handleInputChange('hostname', e.target.value)}
                      placeholder="localhost"
                      autoComplete="off"
                    />
                  </div>
                  
                  <div className="port-separator">:</div>
                  
                  <div className="port-group">
                    <input
                      type="number"
                      value={formData.port}
                      onChange={(e) => handleInputChange('port', parseInt(e.target.value) || '')}
                      min="1"
                      max="65535"
                    />
                  </div>
                </div>
                {errors.hostname && <span className="error-text">{errors.hostname}</span>}
                {errors.port && <span className="error-text">{errors.port}</span>}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="clientId">Client ID *</label>
                  <input
                    id="clientId"
                    type="text"
                    value={formData.clientId}
                    onChange={(e) => handleInputChange('clientId', e.target.value)}
                    className={errors.clientId ? 'error' : ''}
                    autoComplete="off"
                  />
                  {errors.clientId && <span className="error-text">{errors.clientId}</span>}
                </div>
                
                <div className="form-group">
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
            </div>

            <div className="form-section">
              <h3>Authentication</h3>
              
              <div className="form-row">
                <div className="form-group">
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
                
                <div className="form-group">
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

            <div className="form-section">
              <h3>Options</h3>
              
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.clean}
                    onChange={(e) => handleInputChange('clean', e.target.checked)}
                  />
                  Clean Session
                </label>
              </div>
            </div>

            <div className="form-section">
              <div className="section-header">
                <h3>Subscriptions</h3>
                <button type="button" onClick={addSubscription} className="add-subscription-btn">
                  + Add Topic
                </button>
              </div>
              
              {formData.subscriptions.map((subscription, index) => (
                <div key={index} className="subscription-row">
                  <div className="form-group flex-grow">
                    <label htmlFor={`topic-${index}`}>Topic</label>
                    <input
                      id={`topic-${index}`}
                      type="text"
                      value={subscription.topic}
                      onChange={(e) => handleSubscriptionChange(index, 'topic', e.target.value)}
                      placeholder="Topic (e.g., sensors/+/temperature)"
                      className={errors[`subscription_${index}`] ? 'error' : ''}
                      autoComplete="off"
                    />
                    {errors[`subscription_${index}`] && (
                      <span className="error-text">{errors[`subscription_${index}`]}</span>
                    )}
                  </div>
                  
                  <div className="form-group qos-group">
                    <label htmlFor={`qos-${index}`}>QoS</label>
                    <select
                      id={`qos-${index}`}
                      value={subscription.qos}
                      onChange={(e) => handleSubscriptionChange(index, 'qos', e.target.value)}
                    >
                      <option value={0}>QoS 0</option>
                      <option value={1}>QoS 1</option>
                      <option value={2}>QoS 2</option>
                    </select>
                  </div>
                  
                  {formData.subscriptions.length > 1 && (
                    <div className="form-group remove-btn-group">
                      <label>&nbsp;</label>
                      <button
                        type="button"
                        onClick={() => removeSubscription(index)}
                        className="remove-subscription-btn1"
                        title="Remove subscription"
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </form>
        </div>

        <div className="modal-footer">
          <div className="footer-right">
            <button type="button" onClick={onCancel} className="cancel-btn">
              Cancel
            </button>
            <button onClick={handleSubmit} className="save-btn" type="button">
              {connection ? 'Update' : 'Create'} Connection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConnectionModal;