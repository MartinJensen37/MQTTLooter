import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import './ConnectionModal.css';

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
    protocolVersion: 4,
    // Websocket
    wsPath: '/mqtt',
    // TLS/SSL Certificate options
    tls: {
      enabled: false,
      rejectUnauthorized: true,
      ca: null,
      cert: null,
      key: null,
      passphrase: '',
      servername: '',
      alpnProtocols: []
    },
    // MQTT 5.0 Properties
    sessionExpiryInterval: 0,
    receiveMaximum: 65535,
    maximumPacketSize: 268435455,
    topicAliasMaximum: 0,
    requestResponseInformation: false,
    requestProblemInformation: true,
    userProperties: {},
    // Last Will and Testament
    willEnabled: false,
    willTopic: '',
    willMessage: '',
    willQos: 0,
    willRetain: false,
    willDelayInterval: 0,
    willMessageExpiryInterval: 0,
    subscriptions: [{ topic: '#', qos: 0 }]
  });

  const [errors, setErrors] = useState({});
  const firstInputRef = useRef(null);

  const parseBrokerUrl = (url) => {
    try {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol.replace(':', '');
      const hostname = urlObj.hostname;
      const port = parseInt(urlObj.port) || (protocol === 'mqtt' ? 1883 : protocol === 'mqtts' ? 8883 : protocol === 'ws' ? 80 : 443);
      const pathname = urlObj.pathname || '';
      
      return { protocol, hostname, port, pathname };
    } catch (error) {
      return { protocol: 'mqtt', hostname: 'localhost', port: 1883, pathname: '' };
    }
  };

  const buildBrokerUrl = (protocol, hostname, port, wsPath = '') => {
    let baseUrl = `${protocol}://${hostname}:${port}`;
    
    // Add WebSocket path for ws:// and wss:// protocols
    if ((protocol === 'ws' || protocol === 'wss') && wsPath) {
      // Ensure path starts with /
      const path = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
      baseUrl += path;
    }
    
    return baseUrl;
  };

  useEffect(() => {
    if (connection?.config) {
      let protocol = 'mqtt';
      let hostname = 'localhost';
      let port = 1883;
      let wsPath = '/mqtt';

      if (connection.config.brokerUrl) {
        const parsed = parseBrokerUrl(connection.config.brokerUrl);
        protocol = parsed.protocol;
        hostname = parsed.hostname;
        port = parsed.port;
        // Extract WebSocket path from URL if present
        if ((protocol === 'ws' || protocol === 'wss') && parsed.pathname) {
          wsPath = parsed.pathname;
        }
      }

      setFormData({
        name: connection.config.name || '',
        protocol,
        hostname,
        port,
        wsPath: connection.config.wsPath || wsPath,
        clientId: connection.config.clientId || `mqttlooter_${Date.now()}`,
        username: connection.config.username || '',
        password: connection.config.password || '',
        clean: connection.config.clean !== undefined ? connection.config.clean : true,
        keepalive: connection.config.keepalive || 60,
        reconnectPeriod: connection.config.reconnectPeriod || 1000,
        connectTimeout: connection.config.connectTimeout || 30000,
        protocolVersion: connection.config.protocolVersion || 4,
        tls: {
          enabled: connection.config.tls?.enabled || false,
          rejectUnauthorized: connection.config.tls?.rejectUnauthorized !== undefined ? connection.config.tls.rejectUnauthorized : true,
          ca: connection.config.tls?.ca || null,
          cert: connection.config.tls?.cert || null,
          key: connection.config.tls?.key || null,
          passphrase: connection.config.tls?.passphrase || '',
          servername: connection.config.tls?.servername || '',
          alpnProtocols: connection.config.tls?.alpnProtocols || []
        },
        // MQTT 5.0 Properties
        sessionExpiryInterval: connection.config.sessionExpiryInterval || 0,
        receiveMaximum: connection.config.receiveMaximum || 65535,
        maximumPacketSize: connection.config.maximumPacketSize || 268435455,
        topicAliasMaximum: connection.config.topicAliasMaximum || 0,
        requestResponseInformation: connection.config.requestResponseInformation || false,
        requestProblemInformation: connection.config.requestProblemInformation !== undefined ? connection.config.requestProblemInformation : true,
        userProperties: connection.config.userProperties || {},
        // Last Will and Testament
        willEnabled: connection.config.willEnabled || false,
        willTopic: connection.config.willTopic || '',
        willMessage: connection.config.willMessage || '',
        willQos: connection.config.willQos || 0,
        willRetain: connection.config.willRetain || false,
        willDelayInterval: connection.config.willDelayInterval || 0,
        willMessageExpiryInterval: connection.config.willMessageExpiryInterval || 0,
        subscriptions: connection.config.subscriptions || [{ topic: '#', qos: 0 }]
      });
    } else {
      // For new connections
      setFormData({
        name: '',
        protocol: 'mqtt',
        hostname: 'localhost',
        port: 1883,
        wsPath: '/mqtt',
        clientId: `mqttlooter_${Date.now()}`,
        username: '',
        password: '',
        clean: true,
        keepalive: 60,
        reconnectPeriod: 1000,
        connectTimeout: 30000,
        protocolVersion: 4,
        tls: {
          enabled: false,
          rejectUnauthorized: true,
          ca: null,
          cert: null,
          key: null,
          passphrase: '',
          servername: '',
          alpnProtocols: []
        },
        // MQTT 5.0 Properties
        sessionExpiryInterval: 0,
        receiveMaximum: 65535,
        maximumPacketSize: 268435455,
        topicAliasMaximum: 0,
        requestResponseInformation: false,
        requestProblemInformation: true,
        userProperties: {},
        // Last Will and Testament
        willEnabled: false,
        willTopic: '',
        willMessage: '',
        willQos: 0,
        willRetain: false,
        willDelayInterval: 0,
        willMessageExpiryInterval: 0,
        subscriptions: [{ topic: '#', qos: 0 }]
      });
    }
    setErrors({});
  }, [connection]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (firstInputRef.current) {
        firstInputRef.current.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleProtocolChange = (protocol) => {
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

    setFormData(prev => ({ 
      ...prev, 
      protocol, 
      port: defaultPort,
      wsPath: defaultWsPath
    }));
    
    if (errors.protocol) {
      setErrors(prev => ({ ...prev, protocol: null }));
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const handleSubscriptionChange = (index, field, value) => {
    const newSubscriptions = [...formData.subscriptions];
    newSubscriptions[index] = {
      ...newSubscriptions[index],
      [field]: field === 'qos' ? parseInt(value) : value
    };
    setFormData(prev => ({ ...prev, subscriptions: newSubscriptions }));
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

    if (!formData.hostname.trim()) {
      newErrors.hostname = 'Hostname is required';
    }

    if (!formData.port || formData.port < 1 || formData.port > 65535) {
      newErrors.port = 'Port must be between 1 and 65535';
    }

    if (!formData.clientId.trim()) {
      newErrors.clientId = 'Client ID is required';
    }

    if ((formData.protocol === 'ws' || formData.protocol === 'wss')) {
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
      const brokerUrl = buildBrokerUrl(formData.protocol, formData.hostname, formData.port, formData.wsPath);
      const finalFormData = { 
        ...formData, 
        brokerUrl,
        ...(formData.protocolVersion === 5 && {
          sessionExpiryInterval: formData.sessionExpiryInterval,
          receiveMaximum: formData.receiveMaximum,
          maximumPacketSize: formData.maximumPacketSize,
          topicAliasMaximum: formData.topicAliasMaximum,
          requestResponseInformation: formData.requestResponseInformation,
          requestProblemInformation: formData.requestProblemInformation,
          userProperties: formData.userProperties
        })
      };
      
      delete finalFormData.protocol;
      delete finalFormData.hostname;
      delete finalFormData.port;
      // Keep wsPath in finalFormData for the connection manager
      
      console.log('Submitting connection with protocol version:', finalFormData.protocolVersion);
      onSave(finalFormData);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  const handleFileSelect = async (fileType, event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const fileContent = await file.text();
      setFormData(prev => ({
        ...prev,
        tls: {
          ...prev.tls,
          [fileType]: {
            name: file.name,
            content: fileContent,
            size: file.size,
            lastModified: file.lastModified
          }
        }
      }));
    } catch (error) {
      console.error(`Error reading ${fileType} file:`, error);
      toast.error(`Failed to read ${fileType} file`);
    }
  };

  const clearCertificateFile = (fileType) => {
    setFormData(prev => ({
      ...prev,
      tls: {
        ...prev.tls,
        [fileType]: null
      }
    }));
  };

  return (
    <div className="mqtt-modal-overlay" onClick={handleOverlayClick}>
      <div className="mqtt-modal-container">
        <div className="mqtt-modal-header">
          <h2>{connection ? 'Edit Connection' : 'New Connection'}</h2>
          <button className="mqtt-modal-close" onClick={onCancel} type="button">×</button>
        </div>

        <form onSubmit={handleSubmit} className="mqtt-modal-form">
          <div className="mqtt-modal-content">
            
            {/* Connection Details Section */}
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
                <div className={`mqtt-broker-url ${(errors.hostname || errors.port) ? 'error' : ''}`}>
                  <select
                    value={formData.protocol}
                    onChange={(e) => handleProtocolChange(e.target.value)}
                    className="mqtt-protocol"
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

              {/* WebSocket Path Field - Show only for WebSocket protocols */}
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
                <select
                  id="protocolVersion"
                  value={formData.protocolVersion}
                  onChange={(e) => handleInputChange('protocolVersion', parseInt(e.target.value))}
                  className="mqtt-protocol-version"
                >
                  <option value={4}>MQTT 3.1.1</option>
                  <option value={5}>MQTT 5.0</option>
                </select>
                <div className="mqtt-field-hint">
                  {formData.protocolVersion === 5 
                    ? 'MQTT 5.0 includes enhanced features like user properties, message expiry, and topic aliases'
                    : 'MQTT 3.1.1 is the stable, widely-supported version'
                  }
                </div>
              </div>
            </div>

            {/* MQTT 5.0 Specific Options */}
            {formData.protocolVersion === 5 && (
              <div className="mqtt-form-section mqtt5-section">
                <h3 className="mqtt-section-title">
                  MQTT 5.0 Properties
                </h3>
                
                <div className="mqtt-form-row">
                  <div className="mqtt-form-group">
                    <label htmlFor="sessionExpiryInterval">Session Expiry Interval (seconds)</label>
                    <input
                      id="sessionExpiryInterval"
                      type="number"
                      value={formData.sessionExpiryInterval}
                      onChange={(e) => handleInputChange('sessionExpiryInterval', parseInt(e.target.value) || 0)}
                      min="0"
                      placeholder="0"
                    />
                    <div className="mqtt-field-hint">0 = Session expires when network connection closes</div>
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
                    <div className="mqtt-field-hint">Maximum number of QoS 1 and 2 publications</div>
                  </div>
                </div>

                <div className="mqtt-form-row">
                  <div className="mqtt-form-group">
                    <label htmlFor="maximumPacketSize">Maximum Packet Size (bytes)</label>
                    <input
                      id="maximumPacketSize"
                      type="number"
                      value={formData.maximumPacketSize}
                      onChange={(e) => handleInputChange('maximumPacketSize', parseInt(e.target.value) || 268435455)}
                      min="1"
                      placeholder="268435455"
                    />
                    <div className="mqtt-field-hint">Maximum packet size this client will accept</div>
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
                    <div className="mqtt-field-hint">0 = No topic aliases supported</div>
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
                      <span className="mqtt-connection-modal-checkbox-text">Request Response Information</span>
                    </label>
                    <div className="mqtt-field-hint">Request server to return response information</div>
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
                    <div className="mqtt-field-hint">Request server to return problem information in case of failures</div>
                  </div>
                </div>
              </div>
            )}

            {/* Authentication Section */}
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
            <div className="mqtt-form-section">
              <h3 className="mqtt-section-title">TLS/SSL Configuration</h3>
              
              <div className="mqtt-form-group">
                <label className="mqtt-connection-modal-checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.tls.enabled}
                    onChange={(e) => handleInputChange('tls', { ...formData.tls, enabled: e.target.checked })}
                  />
                  <div className="mqtt-connection-modal-checkbox-custom"></div>
                  <span className="mqtt-connection-modal-checkbox-text">Enable TLS/SSL</span>
                </label>
                <div className="mqtt-field-hint">
                  Enable secure connection using TLS/SSL (required for mqtts:// and wss://)
                </div>
              </div>

              {(formData.tls.enabled || formData.protocol === 'mqtts' || formData.protocol === 'wss') && (
                <>
                  <div className="mqtt-form-group">
                    <label className="mqtt-connection-modal-checkbox-label">
                      <input
                        type="checkbox"
                        checked={formData.tls.rejectUnauthorized}
                        onChange={(e) => handleInputChange('tls', { ...formData.tls, rejectUnauthorized: e.target.checked })}
                      />
                      <div className="mqtt-connection-modal-checkbox-custom"></div>
                      <span className="mqtt-connection-modal-checkbox-text">Verify Server Certificate</span>
                    </label>
                    <div className="mqtt-field-hint">
                      Uncheck to allow self-signed certificates (not recommended for production)
                    </div>
                  </div>

                  <div className="mqtt-form-group">
                    <label htmlFor="servername">Server Name (SNI)</label>
                    <input
                      id="servername"
                      type="text"
                      value={formData.tls.servername}
                      onChange={(e) => handleInputChange('tls', { ...formData.tls, servername: e.target.value })}
                      placeholder="Optional - override hostname for SNI"
                      autoComplete="off"
                    />
                    <div className="mqtt-field-hint">
                      Server Name Indication - leave empty to use hostname
                    </div>
                  </div>

                  {/* CA Certificate */}
                  <div className="mqtt-form-group">
                    <label>CA Certificate (Optional)</label>
                    <div className="mqtt-certificate-upload">
                      <input
                        type="file"
                        accept=".crt,.pem,.cer"
                        onChange={(e) => handleFileSelect('ca', e)}
                        style={{ display: 'none' }}
                        id="ca-cert-upload"
                      />
                      <label htmlFor="ca-cert-upload" className="mqtt-file-upload-btn">
                        <i className="fas fa-upload"></i>
                        Choose CA Certificate
                      </label>
                      {formData.tls.ca && (
                        <div className="mqtt-certificate-info">
                          <div className="mqtt-cert-details">
                            <span className="mqtt-cert-name">{formData.tls.ca.name}</span>
                            <span className="mqtt-cert-size">({(formData.tls.ca.size / 1024).toFixed(1)} KB)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => clearCertificateFile('ca')}
                            className="mqtt-cert-remove"
                            title="Remove certificate"
                          >
                            <i className="fas fa-times"></i>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="mqtt-field-hint">
                      Certificate Authority certificate for server verification
                    </div>
                  </div>

                  {/* Client Certificate */}
                  <div className="mqtt-form-group">
                    <label>Client Certificate (Optional)</label>
                    <div className="mqtt-certificate-upload">
                      <input
                        type="file"
                        accept=".crt,.pem,.cer"
                        onChange={(e) => handleFileSelect('cert', e)}
                        style={{ display: 'none' }}
                        id="client-cert-upload"
                      />
                      <label htmlFor="client-cert-upload" className="mqtt-file-upload-btn">
                        <i className="fas fa-upload"></i>
                        Choose Client Certificate
                      </label>
                      {formData.tls.cert && (
                        <div className="mqtt-certificate-info">
                          <div className="mqtt-cert-details">
                            <span className="mqtt-cert-name">{formData.tls.cert.name}</span>
                            <span className="mqtt-cert-size">({(formData.tls.cert.size / 1024).toFixed(1)} KB)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => clearCertificateFile('cert')}
                            className="mqtt-cert-remove"
                            title="Remove certificate"
                          >
                            <i className="fas fa-times"></i>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="mqtt-field-hint">
                      Client certificate for mutual TLS authentication
                    </div>
                  </div>

                  {/* Private Key */}
                  <div className="mqtt-form-group">
                    <label>Private Key (Optional)</label>
                    <div className="mqtt-certificate-upload">
                      <input
                        type="file"
                        accept=".key,.pem"
                        onChange={(e) => handleFileSelect('key', e)}
                        style={{ display: 'none' }}
                        id="private-key-upload"
                      />
                      <label htmlFor="private-key-upload" className="mqtt-file-upload-btn">
                        <i className="fas fa-upload"></i>
                        Choose Private Key
                      </label>
                      {formData.tls.key && (
                        <div className="mqtt-certificate-info">
                          <div className="mqtt-cert-details">
                            <span className="mqtt-cert-name">{formData.tls.key.name}</span>
                            <span className="mqtt-cert-size">({(formData.tls.key.size / 1024).toFixed(1)} KB)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => clearCertificateFile('key')}
                            className="mqtt-cert-remove"
                            title="Remove key"
                          >
                            <i className="fas fa-times"></i>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="mqtt-field-hint">
                      Private key corresponding to the client certificate
                    </div>
                  </div>

                  {/* Passphrase for private key */}
                  {formData.tls.key && (
                    <div className="mqtt-form-group">
                      <label htmlFor="key-passphrase">Private Key Passphrase</label>
                      <input
                        id="key-passphrase"
                        type="password"
                        value={formData.tls.passphrase}
                        onChange={(e) => handleInputChange('tls', { ...formData.tls, passphrase: e.target.value })}
                        placeholder="Leave empty if key is not encrypted"
                        autoComplete="new-password"
                      />
                      <div className="mqtt-field-hint">
                        Passphrase for encrypted private key
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Last Will and Testament */}
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
                      <select
                        id="willQos"
                        value={formData.willQos}
                        onChange={(e) => handleInputChange('willQos', parseInt(e.target.value))}
                      >
                        <option value={0}>0 - At most once</option>
                        <option value={1}>1 - At least once</option>
                        <option value={2}>2 - Exactly once</option>
                      </select>
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
                      <div className="mqtt-field-hint">Delay before publishing the will message after disconnect</div>
                    </div>
                    
                    {formData.protocolVersion === 5 && (
                      <div className="mqtt-form-group">
                        <label htmlFor="willMessageExpiryInterval">Will Message Expiry (s)</label>
                        <input
                          id="willMessageExpiryInterval"
                          type="number"
                          value={formData.willMessageExpiryInterval}
                          onChange={(e) => handleInputChange('willMessageExpiryInterval', parseInt(e.target.value) || 0)}
                          min="0"
                          placeholder="0"
                        />
                        <div className="mqtt-field-hint">0 = Will message never expires (MQTT 5.0 only)</div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Options Section */}
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

            {/* Subscriptions Section */}
            <div className="mqtt-form-section">
              <div className="mqtt-section-header">
                <h3 className="mqtt-section-title">Subscriptions</h3>
                <button type="button" onClick={addSubscription} className="mqtt-add-btn">
                  + Add Topic
                </button>
              </div>
              
              {formData.subscriptions.map((subscription, index) => (
                <div key={index} className="mqtt-subscription-row">
                  <div className="mqtt-form-group mqtt-topic-group">
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
                      <span className="mqtt-error-text">{errors[`subscription_${index}`]}</span>
                    )}
                  </div>
                  
                  <div className="mqtt-form-group mqtt-qos-group">
                    <label htmlFor={`qos-${index}`}>QoS</label>
                    <select
                      id={`qos-${index}`}
                      value={subscription.qos}
                      onChange={(e) => handleSubscriptionChange(index, 'qos', e.target.value)}
                    >
                      <option value={0}>0</option>
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                    </select>
                  </div>
                  
                  {formData.subscriptions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSubscription(index)}
                      className="mqtt-remove-btn"
                      title="Remove subscription"
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  )}
                </div>
              ))}
            </div>
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