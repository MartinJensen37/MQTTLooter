import React, { useState, useEffect } from 'react';

function ConnectionModal({ connection, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    name: '',
    brokerUrl: 'mqtt://localhost:1883',
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

  useEffect(() => {
    if (connection?.config) {
      setFormData({
        name: connection.config.name || '',
        brokerUrl: connection.config.brokerUrl || 'mqtt://localhost:1883',
        clientId: connection.config.clientId || `mqttlooter_${Date.now()}`,
        username: connection.config.username || '',
        password: connection.config.password || '',
        clean: connection.config.clean !== undefined ? connection.config.clean : true,
        keepalive: connection.config.keepalive || 60,
        reconnectPeriod: connection.config.reconnectPeriod || 1000,
        connectTimeout: connection.config.connectTimeout || 30000,
        subscriptions: connection.config.subscriptions || [{ topic: '#', qos: 0 }]
      });
    }
  }, [connection]);

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

    if (!formData.brokerUrl.trim()) {
      newErrors.brokerUrl = 'Broker URL is required';
    } else if (!/^mqtts?:\/\/.+/.test(formData.brokerUrl)) {
      newErrors.brokerUrl = 'Invalid MQTT URL format (use mqtt:// or mqtts://)';
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
      onSave(formData);
    }
  };

  const handleTestConnection = () => {
    // TODO: Implement test connection functionality
    alert('Test connection functionality coming soon!');
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="connection-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{connection ? 'Edit Connection' : 'New Connection'}</h2>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-content">
          <div className="form-section">
            <h3>Connection Details</h3>
            
            <div className="form-group">
              <label htmlFor="name">Connection Name *</label>
              <input
                id="name"
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="My MQTT Broker"
                className={errors.name ? 'error' : ''}
              />
              {errors.name && <span className="error-text">{errors.name}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="brokerUrl">Broker URL *</label>
              <input
                id="brokerUrl"
                type="text"
                value={formData.brokerUrl}
                onChange={(e) => handleInputChange('brokerUrl', e.target.value)}
                placeholder="mqtt://localhost:1883"
                className={errors.brokerUrl ? 'error' : ''}
              />
              {errors.brokerUrl && <span className="error-text">{errors.brokerUrl}</span>}
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
                  <input
                    type="text"
                    value={subscription.topic}
                    onChange={(e) => handleSubscriptionChange(index, 'topic', e.target.value)}
                    placeholder="Topic (e.g., sensors/+/temperature)"
                    className={errors[`subscription_${index}`] ? 'error' : ''}
                  />
                  {errors[`subscription_${index}`] && (
                    <span className="error-text">{errors[`subscription_${index}`]}</span>
                  )}
                </div>
                
                <div className="form-group">
                  <select
                    value={subscription.qos}
                    onChange={(e) => handleSubscriptionChange(index, 'qos', e.target.value)}
                  >
                    <option value={0}>QoS 0</option>
                    <option value={1}>QoS 1</option>
                    <option value={2}>QoS 2</option>
                  </select>
                </div>
                
                {formData.subscriptions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSubscription(index)}
                    className="remove-subscription-btn"
                    title="Remove subscription"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </form>

        <div className="modal-footer">
          <div className="footer-left">
            <button type="button" onClick={handleTestConnection} className="test-btn">
              Test Connection
            </button>
          </div>
          
          <div className="footer-right">
            <button type="button" onClick={onCancel} className="cancel-btn">
              Cancel
            </button>
            <button onClick={handleSubmit} className="save-btn">
              {connection ? 'Update' : 'Create'} Connection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConnectionModal;