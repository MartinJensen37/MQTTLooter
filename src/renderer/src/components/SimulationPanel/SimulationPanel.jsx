import React, { useState, useEffect, useRef } from 'react';
import './SimulationPanel.css';

// Data type configurations
const DATA_TYPE_CONFIGS = {
  number: {
    label: 'Number',
    generators: ['static', 'uniform', 'normal', 'sine', 'exponential'],
    hasUnit: true,
    hasDecimalPrecision: true
  },
  boolean: {
    label: 'Boolean',
    generators: ['static', 'probability', 'pattern'],
    hasUnit: false,
    hasDecimalPrecision: false
  },
  string: {
    label: 'String',
    generators: ['static', 'list', 'weighted'],
    hasUnit: false,
    hasDecimalPrecision: false
  },
  enum: {
    label: 'Enum',
    generators: ['static', 'random', 'weighted', 'pattern'],
    hasUnit: false,
    hasDecimalPrecision: false
  }
};

const GENERATOR_CONFIGS = {
  static: { label: 'Static Value', fields: ['value'] },
  uniform: { label: 'Uniform Random', fields: ['min', 'max'] },
  normal: { label: 'Normal Distribution', fields: ['mean', 'stdDev', 'min', 'max'] },
  sine: { label: 'Sine Wave', fields: ['min', 'max', 'frequency'] },
  exponential: { label: 'Exponential', fields: ['lambda', 'min', 'max'] },
  probability: { label: 'Probability', fields: ['trueProbability'] },
  pattern: { label: 'Pattern Sequence', fields: ['sequence'] },
  list: { label: 'Random from List', fields: ['values'] },
  weighted: { label: 'Weighted Random', fields: ['weightedValues'] },
  random: { label: 'Random Selection', fields: ['values'] }
};

function SimulationPanel({ 
  connectionId,
  onPublishMessage,
  isConnected,
  selectedTopic
}) {
  const [simulatedDevices, setSimulatedDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [showEditOutput, setShowEditOutput] = useState(false);
  const [editingOutput, setEditingOutput] = useState(null);
  
  const publishIntervalsRef = useRef({});

  // Clear selected device when connection changes
  useEffect(() => {
    setSelectedDevice(null);
  }, [connectionId]);

  // Load devices from localStorage
  useEffect(() => {
    if (!connectionId) return;
    
    const savedDevices = localStorage.getItem(`mqtt-simulation-devices-${connectionId}`);
    if (savedDevices) {
      try {
        const devices = JSON.parse(savedDevices);
        setSimulatedDevices(devices);
        if (devices.length > 0 && !selectedDevice) {
          setSelectedDevice(devices[0].id);
        }
        
        // Restore publishing intervals for active devices
        if (isConnected) {
          devices.forEach(device => {
            if (device.isPublishing) {
              startPublishing(device.id, device.publishInterval);
            }
          });
        }
      } catch (error) {
        console.error('Failed to load simulation devices:', error);
      }
    } else {
      setSimulatedDevices([]);
    }
  }, [connectionId]);

  // Save devices to localStorage
  useEffect(() => {
    if (connectionId && simulatedDevices.length >= 0) {
      localStorage.setItem(`mqtt-simulation-devices-${connectionId}`, JSON.stringify(simulatedDevices));
    }
  }, [simulatedDevices, connectionId]);

  // Handle connection state changes
  useEffect(() => {
    if (isConnected) {
      // Restart publishing for devices that should be publishing
      simulatedDevices.forEach(device => {
        if (device.isPublishing && !publishIntervalsRef.current[device.id]) {
          startPublishing(device.id, device.publishInterval);
        }
      });
    } else {
      // Stop all publishing when disconnected
      Object.keys(publishIntervalsRef.current).forEach(deviceId => {
        if (publishIntervalsRef.current[deviceId]) {
          clearInterval(publishIntervalsRef.current[deviceId]);
          delete publishIntervalsRef.current[deviceId];
        }
      });
    }
  }, [isConnected]);

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      Object.values(publishIntervalsRef.current).forEach(interval => {
        if (interval) clearInterval(interval);
      });
    };
  }, []);

  const createNewDevice = (deviceData) => {
    const newDevice = {
      id: Date.now(),
      name: deviceData.name,
      topic: deviceData.topic,
      publishInterval: deviceData.publishInterval || 5000,
      isPublishing: false,
      outputs: [
        {
          id: Date.now(),
          name: 'temperature',
          dataType: 'number',
          generator: 'normal',
          unit: '°C',
          decimalPrecision: 2,
          includeTimestamp: true,
          config: {
            mean: 21.5,
            stdDev: 1.5,
            min: 18,
            max: 25
          },
          currentValue: 21.5
        }
      ]
    };
    
    setSimulatedDevices(prev => [...prev, newDevice]);
    setSelectedDevice(newDevice.id);
    setShowAddDevice(false);
  };

  const deleteDevice = (deviceId) => {
    if (publishIntervalsRef.current[deviceId]) {
      clearInterval(publishIntervalsRef.current[deviceId]);
      delete publishIntervalsRef.current[deviceId];
    }
    
    setSimulatedDevices(prev => prev.filter(d => d.id !== deviceId));
    
    if (selectedDevice === deviceId) {
      const remaining = simulatedDevices.filter(d => d.id !== deviceId);
      setSelectedDevice(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const getSelectedDeviceData = () => {
    return simulatedDevices.find(d => d.id === selectedDevice);
  };

  const updateDevice = (deviceId, updates) => {
    setSimulatedDevices(prev => prev.map(device => 
      device.id === deviceId ? { ...device, ...updates } : device
    ));
  };

  const generateValue = (output) => {
    const { dataType, generator, config, decimalPrecision } = output;
    
    switch (dataType) {
      case 'number':
        return generateNumberValue(generator, config, decimalPrecision);
      case 'boolean':
        return generateBooleanValue(generator, config);
      case 'string':
        return generateStringValue(generator, config);
      case 'enum':
        return generateEnumValue(generator, config);
      default:
        return 0;
    }
  };

  const generateNumberValue = (generator, config, decimalPrecision = 2) => {
    let value;
    
    switch (generator) {
      case 'static':
        value = config.value || 0;
        break;
        
      case 'uniform':
        const range = (config.max || 100) - (config.min || 0);
        value = (config.min || 0) + Math.random() * range;
        break;
        
      case 'normal':
        const u1 = Math.random();
        const u2 = Math.random();
        const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        value = (config.mean || 0) + z0 * (config.stdDev || 1);
        
        if (config.min !== undefined) value = Math.max(value, config.min);
        if (config.max !== undefined) value = Math.min(value, config.max);
        break;
        
      case 'sine':
        const time = Date.now() / 1000;
        const amplitude = ((config.max || 100) - (config.min || 0)) / 2;
        const offset = (config.min || 0) + amplitude;
        const frequency = config.frequency || 0.1;
        value = offset + amplitude * Math.sin(2 * Math.PI * frequency * time);
        break;
        
      case 'exponential':
        const lambda = config.lambda || 1;
        value = -Math.log(1 - Math.random()) / lambda;
        if (config.min !== undefined) value = Math.max(value, config.min);
        if (config.max !== undefined) value = Math.min(value, config.max);
        break;
        
      default:
        value = config.min || 0;
    }
    
    return Number(value.toFixed(decimalPrecision || 2));
  };

  const generateBooleanValue = (generator, config) => {
    switch (generator) {
      case 'static':
        return Boolean(config.value);
        
      case 'probability':
        const trueProbability = config.trueProbability || 0.5;
        return Math.random() < trueProbability;
        
      case 'pattern':
        if (!config.sequence || !Array.isArray(config.sequence) || config.sequence.length === 0) {
          return Math.random() > 0.5;
        }
        const index = Math.floor(Date.now() / (config.intervalMs || 5000)) % config.sequence.length;
        return Boolean(config.sequence[index]);
        
      default:
        return Math.random() > 0.5;
    }
  };

  const generateStringValue = (generator, config) => {
    switch (generator) {
      case 'static':
        return String(config.value || 'default');
        
      case 'list':
      case 'random':
        if (!config.values || !Array.isArray(config.values) || config.values.length === 0) {
          return 'default';
        }
        const randomIndex = Math.floor(Math.random() * config.values.length);
        return config.values[randomIndex];
        
      case 'weighted':
        if (!config.weightedValues || !Array.isArray(config.weightedValues) || config.weightedValues.length === 0) {
          return 'default';
        }
        
        const totalWeight = config.weightedValues.reduce((sum, item) => sum + (item.weight || 1), 0);
        let random = Math.random() * totalWeight;
        
        for (const item of config.weightedValues) {
          random -= (item.weight || 1);
          if (random <= 0) {
            return item.value;
          }
        }
        
        return config.weightedValues[0].value;
        
      default:
        return 'default';
    }
  };

  const generateEnumValue = (generator, config) => {
    return generateStringValue(generator, config);
  };

  const generatePayload = (device) => {
    const payload = {};
    
    device.outputs.forEach(output => {
      const value = generateValue(output);
      
      // Update current value for display
      updateDevice(device.id, {
        outputs: device.outputs.map(o => 
          o.id === output.id ? { ...o, currentValue: value } : o
        )
      });
      
      const outputPayload = {
        value: value
      };
      
      // Add unit for numeric types if specified
      if (output.dataType === 'number' && output.unit && output.unit.trim()) {
        outputPayload.unit = output.unit.trim();
      }
      
      // Add timestamp if enabled
      if (output.includeTimestamp !== false) {
        outputPayload.timestamp = new Date().toISOString();
      }
      
      payload[output.name] = outputPayload;
    });
    
    // Flatten payload if only one output
    const outputNames = Object.keys(payload);
    if (outputNames.length === 1) {
      return JSON.stringify(payload[outputNames[0]]);
    }
    
    return JSON.stringify(payload);
  };

  const startPublishing = (deviceId, interval) => {
    if (publishIntervalsRef.current[deviceId]) {
      clearInterval(publishIntervalsRef.current[deviceId]);
    }
    
    publishIntervalsRef.current[deviceId] = setInterval(() => {
      publishOnce(deviceId);
    }, interval);
  };

  const publishOnce = (deviceId) => {
    const device = simulatedDevices.find(d => d.id === deviceId);
    if (!device || !isConnected) return;
    
    const payload = generatePayload(device);
    
    onPublishMessage({
      topic: device.topic,
      payload: payload,
      qos: 0,
      retain: false
    });
  };

  const togglePublishing = (deviceId) => {
    const device = simulatedDevices.find(d => d.id === deviceId);
    if (!device) return;
    
    if (device.isPublishing) {
      if (publishIntervalsRef.current[deviceId]) {
        clearInterval(publishIntervalsRef.current[deviceId]);
        delete publishIntervalsRef.current[deviceId];
      }
      updateDevice(deviceId, { isPublishing: false });
    } else {
      if (!isConnected) return;
      
      updateDevice(deviceId, { isPublishing: true });
      startPublishing(deviceId, device.publishInterval);
    }
  };

  const addOutput = (deviceId) => {
    const newOutput = {
      id: Date.now(),
      name: 'new_sensor',
      dataType: 'number',
      generator: 'normal',
      unit: '',
      decimalPrecision: 2,
      includeTimestamp: true,
      config: {
        mean: 50,
        stdDev: 10,
        min: 0,
        max: 100
      },
      currentValue: 50
    };
    
    const device = simulatedDevices.find(d => d.id === deviceId);
    if (device) {
      updateDevice(deviceId, {
        outputs: [...device.outputs, newOutput]
      });
    }
  };

  const removeOutput = (deviceId, outputId) => {
    const device = simulatedDevices.find(d => d.id === deviceId);
    if (device) {
      updateDevice(deviceId, {
        outputs: device.outputs.filter(o => o.id !== outputId)
      });
    }
  };

  const selectedDeviceData = getSelectedDeviceData();

  return (
    <div className="simulation-panel">
      <div className="simulation-content">
        
        {/* Device Sidebar */}
        <div className="device-sidebar">
          <div className="device-sidebar-header">
            <h3>Simulated Devices</h3>
            <button 
              onClick={() => setShowAddDevice(true)}
              className="btn btn-sm btn-primary add-device-btn"
              title="Add Simulated Device"
            >
              <i className="fas fa-plus"></i>
            </button>
          </div>
          
          <div className="device-list">
            {simulatedDevices.length === 0 ? (
              <div className="no-devices">
                <i className="fas fa-microchip"></i>
                <p>No simulated devices yet.</p>
                <p>Click + to add one.</p>
              </div>
            ) : (
              simulatedDevices.map(device => (
                <div 
                  key={device.id}
                  className={`device-item ${selectedDevice === device.id ? 'selected' : ''}`}
                  onClick={() => setSelectedDevice(device.id)}
                >
                  <div className="device-info">
                    <i className={`fas fa-${device.isPublishing ? 'broadcast-tower' : 'microchip'} device-icon ${device.isPublishing ? 'publishing' : ''}`}></i>
                    <span className="device-name">{device.name}</span>
                  </div>
                  <div className="device-actions">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDevice(device.id);
                      }}
                      className="btn btn-sm delete-device-btn"
                      title="Delete device"
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Device Configuration Panel */}
        <div className="device-config-panel">
          {selectedDeviceData ? (
            <DeviceConfigPanel 
              device={selectedDeviceData}
              onUpdateDevice={updateDevice}
              onPublishOnce={publishOnce}
              onTogglePublishing={togglePublishing}
              onAddOutput={addOutput}
              onRemoveOutput={removeOutput}
              isConnected={isConnected}
              onEditOutput={(output) => {
                setEditingOutput(output);
                setShowEditOutput(true);
              }}
            />
          ) : (
            <div className="no-device-selected">
              <div className="no-device-icon">
                <i className="fas fa-microchip"></i>
              </div>
              <h3>No Device Selected</h3>
              <p>Select a simulated device from the sidebar to configure it.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showAddDevice && (
        <AddDeviceModal 
          onClose={() => setShowAddDevice(false)}
          onCreateDevice={createNewDevice}
          selectedTopic={selectedTopic}
        />
      )}

      {showEditOutput && editingOutput && selectedDeviceData && (
        <EditOutputModal 
          output={editingOutput}
          onClose={() => {
            setShowEditOutput(false);
            setEditingOutput(null);
          }}
          onSave={(updatedOutput) => {
            updateDevice(selectedDeviceData.id, {
              outputs: selectedDeviceData.outputs.map(o => 
                o.id === editingOutput.id ? { ...o, ...updatedOutput } : o
              )
            });
            setShowEditOutput(false);
            setEditingOutput(null);
          }}
        />
      )}
    </div>
  );
}

// Device Configuration Panel Component
function DeviceConfigPanel({ 
  device, 
  onUpdateDevice, 
  onPublishOnce, 
  onTogglePublishing, 
  onAddOutput, 
  onRemoveOutput,
  isConnected,
  onEditOutput
}) {
  const handleEditOutput = (output) => {
    if (device.isPublishing) {
      onTogglePublishing(device.id);
    }
    onEditOutput(output);
  };

  return (
    <div className="device-config panel">
      <div className="device-config-header">
        <h3>{device.name}</h3>
        <div className="device-status">
          <span className={`status-indicator ${device.isPublishing ? 'publishing' : 'stopped'}`}>
            <i className={`fas fa-${device.isPublishing ? 'broadcast-tower' : 'stop-circle'}`}></i>
            {device.isPublishing ? 'Publishing' : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Outputs Section */}
      <div className="outputs-section">
        <div className="section-header">
          <h4><i className="fas fa-box"></i> Outputs</h4>
          <button 
            onClick={() => onAddOutput(device.id)}
            className="btn btn-sm btn-success add-output-btn"
            title="Add Output"
          >
            <i className="fas fa-plus"></i>
          </button>
        </div>
        
        <div className="outputs-list">
          {device.outputs.map(output => (
            <div key={output.id} className="output-item">
              <div className="output-info">
                <span className="output-name">{output.name}:</span>
                <span className="output-value">
                  {formatOutputValue(output)}
                </span>
                <span className="output-type">{output.dataType}</span>
                {output.includeTimestamp !== false && (
                  <span className="timestamp-indicator" title="Includes timestamp">
                    <i className="fas fa-clock"></i>
                  </span>
                )}
              </div>
              <div className="output-actions">
                <button 
                  onClick={() => handleEditOutput(output)}
                  className="btn btn-sm edit-output-btn"
                  title="Edit output"
                >
                  <i className="fas fa-edit"></i>
                </button>
                <button 
                  onClick={() => onRemoveOutput(device.id, output.id)}
                  className="btn btn-sm remove-output-btn"
                  title="Remove output"
                  disabled={device.outputs.length <= 1}
                >
                  <i className="fas fa-trash"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Publishing Controls */}
      <div className="publishing-controls">
        <div className="interval-control">
          <label><i className="fas fa-clock"></i> Publish Interval:</label>
          <select 
            value={device.publishInterval}
            onChange={(e) => onUpdateDevice(device.id, { publishInterval: parseInt(e.target.value) })}
            className="form-input"
          >
            <option value={1000}>1s</option>
            <option value={2000}>2s</option>
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
            <option value={30000}>30s</option>
            <option value={60000}>1m</option>
          </select>
        </div>

        <div className="publishing-buttons">
          <button 
            onClick={() => onTogglePublishing(device.id)}
            className={`btn btn-md toggle-publishing-btn ${device.isPublishing ? 'btn-danger stop' : 'btn-success start'}`}
            disabled={!isConnected}
          >
            <i className={`fas fa-${device.isPublishing ? 'stop' : 'play'}`}></i>
            {device.isPublishing ? 'Stop Loop' : 'Start Loop'}
          </button>
          
          <button 
            onClick={() => onPublishOnce(device.id)}
            className="btn btn-md btn-primary publish-once-btn"
            disabled={!isConnected}
          >
            <i className="fas fa-paper-plane"></i>
            Publish Once
          </button>
        </div>
      </div>

      {/* Topic Configuration */}
      <div className="form-group topic-section">
        <label><i className="fas fa-tag"></i> MQTT Topic:</label>
        <input 
          type="text"
          value={device.topic}
          onChange={(e) => onUpdateDevice(device.id, { topic: e.target.value })}
          placeholder="sensors/room/temperature"
          className="form-input topic-input"
        />
      </div>

      {!isConnected && (
        <div className="badge badge-warning connection-warning">
          <i className="fas fa-exclamation-triangle"></i>
          Connection not active. Publishing is disabled.
        </div>
      )}
    </div>
  );
}

// Helper function to format output values
function formatOutputValue(output) {
  const value = output.currentValue;
  
  switch (output.dataType) {
    case 'string':
    case 'enum':
      return `"${value}"`;
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return `${value}${output.unit || ''}`;
    default:
      return String(value);
  }
}

function AddDeviceModal({ onClose, onCreateDevice, selectedTopic }) {
  const [deviceName, setDeviceName] = useState('');
  const [deviceTopic, setDeviceTopic] = useState(selectedTopic?.topicPath || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!deviceName.trim() || !deviceTopic.trim()) return;
    
    onCreateDevice({
      name: deviceName.trim(),
      topic: deviceTopic.trim(),
      publishInterval: 5000
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3>Add Simulated Device</h3>
          <button onClick={onClose} className="btn btn-sm modal-close-btn">
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
            <button type="button" onClick={onClose} className="btn btn-md btn-secondary cancel-btn">
              Cancel
            </button>
            <button type="submit" className="btn btn-md btn-primary create-btn">
              Create Device
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Edit Output Modal
function EditOutputModal({ output, onClose, onSave }) {
  const [formData, setFormData] = useState({
    name: output.name,
    dataType: output.dataType,
    generator: output.generator,
    unit: output.unit || '',
    decimalPrecision: output.decimalPrecision || 2,
    includeTimestamp: output.includeTimestamp !== false,
    config: { ...output.config }
  });

  const [previewValue, setPreviewValue] = useState(null);

  // Update preview when form data changes
  useEffect(() => {
    const generatePreview = () => {
      try {
        let value;
        
        switch (formData.dataType) {
          case 'number':
            value = generateNumberPreview(formData.generator, formData.config, formData.decimalPrecision);
            break;
          case 'boolean':
            value = generateBooleanPreview(formData.generator, formData.config);
            break;
          case 'string':
          case 'enum':
            value = generateStringPreview(formData.generator, formData.config);
            break;
          default:
            value = 'N/A';
        }

        const outputPayload = {
          value: value
        };

        if (formData.dataType === 'number' && formData.unit && formData.unit.trim()) {
          outputPayload.unit = formData.unit.trim();
        }

        if (formData.includeTimestamp) {
          outputPayload.timestamp = new Date().toISOString();
        }

        setPreviewValue(outputPayload);
      } catch (error) {
        setPreviewValue({ error: 'Preview generation failed' });
      }
    };

    generatePreview();
    const interval = setInterval(generatePreview, 2000);
    return () => clearInterval(interval);
  }, [formData]);

  const generateNumberPreview = (generator, config, precision) => {
    switch (generator) {
      case 'static':
        return Number((config.value || 0).toFixed(precision));
      case 'uniform':
        const mid = ((config.max || 100) + (config.min || 0)) / 2;
        return Number(mid.toFixed(precision));
      case 'normal':
        return Number((config.mean || 0).toFixed(precision));
      case 'sine':
        return Number(((config.max || 100) + (config.min || 0)) / 2).toFixed(precision);
      case 'exponential':
        return Number(((config.min || 0) + 5).toFixed(precision));
      default:
        return 0;
    }
  };

  const generateBooleanPreview = (generator, config) => {
    switch (generator) {
      case 'static':
        return Boolean(config.value);
      case 'probability':
        return (config.trueProbability || 0.5) > 0.5;
      case 'pattern':
        return config.sequence && config.sequence.length > 0 ? config.sequence[0] : true;
      default:
        return true;
    }
  };

  const generateStringPreview = (generator, config) => {
    switch (generator) {
      case 'static':
        return config.value || 'default';
      case 'list':
      case 'random':
        return config.values && config.values.length > 0 ? config.values[0] : 'default';
      case 'weighted':
        return config.weightedValues && config.weightedValues.length > 0 ? config.weightedValues[0].value : 'default';
      default:
        return 'default';
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const updateFormData = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateConfig = (field, value) => {
    setFormData(prev => ({
      ...prev,
      config: { ...prev.config, [field]: value }
    }));
  };

  const handleDataTypeChange = (newDataType) => {
    const availableGenerators = DATA_TYPE_CONFIGS[newDataType].generators;
    const defaultGenerator = availableGenerators[0];
    
    let defaultConfig = {};
    
    switch (newDataType) {
      case 'number':
        if (defaultGenerator === 'normal') {
          defaultConfig = { mean: 50, stdDev: 10, min: 0, max: 100 };
        } else if (defaultGenerator === 'uniform') {
          defaultConfig = { min: 0, max: 100 };
        } else if (defaultGenerator === 'static') {
          defaultConfig = { value: 50 };
        }
        break;
      case 'boolean':
        if (defaultGenerator === 'probability') {
          defaultConfig = { trueProbability: 0.5 };
        } else if (defaultGenerator === 'static') {
          defaultConfig = { value: true };
        }
        break;
      case 'string':
      case 'enum':
        if (defaultGenerator === 'list') {
          defaultConfig = { values: ['option1', 'option2'] };
        } else if (defaultGenerator === 'static') {
          defaultConfig = { value: 'default' };
        }
        break;
    }

    setFormData(prev => ({
      ...prev,
      dataType: newDataType,
      generator: defaultGenerator,
      config: defaultConfig,
      unit: DATA_TYPE_CONFIGS[newDataType].hasUnit ? prev.unit : '',
      decimalPrecision: DATA_TYPE_CONFIGS[newDataType].hasDecimalPrecision ? prev.decimalPrecision : undefined
    }));
  };

  const handleGeneratorChange = (newGenerator) => {
    let defaultConfig = {};
    
    switch (formData.dataType) {
      case 'number':
        switch (newGenerator) {
          case 'static':
            defaultConfig = { value: 50 };
            break;
          case 'uniform':
            defaultConfig = { min: 0, max: 100 };
            break;
          case 'normal':
            defaultConfig = { mean: 50, stdDev: 10, min: 0, max: 100 };
            break;
          case 'sine':
            defaultConfig = { min: 0, max: 100, frequency: 0.1 };
            break;
          case 'exponential':
            defaultConfig = { lambda: 1, min: 0, max: 100 };
            break;
        }
        break;
      case 'boolean':
        switch (newGenerator) {
          case 'static':
            defaultConfig = { value: true };
            break;
          case 'probability':
            defaultConfig = { trueProbability: 0.5 };
            break;
          case 'pattern':
            defaultConfig = { sequence: [true, false], intervalMs: 5000 };
            break;
        }
        break;
      case 'string':
      case 'enum':
        switch (newGenerator) {
          case 'static':
            defaultConfig = { value: 'default' };
            break;
          case 'list':
          case 'random':
            defaultConfig = { values: ['option1', 'option2'] };
            break;
          case 'weighted':
            defaultConfig = { weightedValues: [{ value: 'option1', weight: 1 }, { value: 'option2', weight: 1 }] };
            break;
        }
        break;
    }

    setFormData(prev => ({
      ...prev,
      generator: newGenerator,
      config: defaultConfig
    }));
  };

  const availableGenerators = DATA_TYPE_CONFIGS[formData.dataType]?.generators || [];

  return (
    <div className="modal-overlay">
      <div className="modal-content modal-large">
        <div className="modal-header">
          <h3>Edit Output: {output.name}</h3>
          <button onClick={onClose} className="btn btn-sm modal-close-btn">
            <i className="fas fa-times"></i>
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="panel-content output-form">
          {/* Base Fields */}
          <div className="form-row">
            <div className="form-group">
              <label>Name:</label>
              <input 
                type="text"
                value={formData.name}
                onChange={(e) => updateFormData('name', e.target.value)}
                className="form-input"
                required
              />
            </div>
            
            <div className="form-group">
              <label>Data Type:</label>
              <select 
                value={formData.dataType}
                onChange={(e) => handleDataTypeChange(e.target.value)}
                className="form-input"
              >
                {Object.entries(DATA_TYPE_CONFIGS).map(([key, config]) => (
                  <option key={key} value={key}>{config.label}</option>
                ))}
              </select>
            </div>

            {/* Unit field - only for number type */}
            {DATA_TYPE_CONFIGS[formData.dataType]?.hasUnit && (
              <div className="form-group">
                <label>Unit:</label>
                <input 
                  type="text"
                  value={formData.unit}
                  onChange={(e) => updateFormData('unit', e.target.value)}
                  placeholder="°C, W, %, etc."
                  className="form-input"
                />
              </div>
            )}

            {/* Decimal precision - only for number type */}
            {DATA_TYPE_CONFIGS[formData.dataType]?.hasDecimalPrecision && (
              <div className="form-group">
                <label>Decimal Places:</label>
                <input 
                  type="number"
                  min="0"
                  max="10"
                  value={formData.decimalPrecision}
                  onChange={(e) => updateFormData('decimalPrecision', parseInt(e.target.value))}
                  className="form-input"
                />
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="timestamp-checkbox">
              <input 
                type="checkbox"
                checked={formData.includeTimestamp}
                onChange={(e) => updateFormData('includeTimestamp', e.target.checked)}
              />
              <i className="fas fa-clock"></i>
              Include timestamp
            </label>
          </div>

          {/* Generator Selection */}
          <div className="form-group">
            <label>Value Generator:</label>
            <select 
              value={formData.generator}
              onChange={(e) => handleGeneratorChange(e.target.value)}
              className="form-input"
            >
              {availableGenerators.map(generator => (
                <option key={generator} value={generator}>
                  {GENERATOR_CONFIGS[generator]?.label || generator}
                </option>
              ))}
            </select>
          </div>

          {/* Dynamic Configuration Fields */}
          <DynamicConfigFields 
            dataType={formData.dataType}
            generator={formData.generator}
            config={formData.config}
            onConfigChange={updateConfig}
          />

          {/* Live Preview */}
          <div className="preview-section">
            <label>Preview Value:</label>
            <div className="preview-value">
              {formatPreviewValue(previewValue)}
            </div>
          </div>
          
          <div className="form-actions">
            <button type="button" onClick={onClose} className="btn btn-md btn-secondary cancel-btn">
              Cancel
            </button>
            <button type="submit" className="btn btn-md btn-primary save-btn">
              Save Output
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Dynamic configuration fields component
function DynamicConfigFields({ dataType, generator, config, onConfigChange }) {
  const renderNumberFields = () => {
    switch (generator) {
      case 'static':
        return (
          <div className="form-group">
            <label>Value:</label>
            <input 
              type="number"
              step="0.01"
              value={config.value || 0}
              onChange={(e) => onConfigChange('value', parseFloat(e.target.value) || 0)}
              className="form-input"
            />
          </div>
        );
      
      case 'uniform':
        return (
          <div className="form-row">
            <div className="form-group">
              <label>Min:</label>
              <input 
                type="number"
                step="0.01"
                value={config.min || 0}
                onChange={(e) => onConfigChange('min', parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Max:</label>
              <input 
                type="number"
                step="0.01"
                value={config.max || 100}
                onChange={(e) => onConfigChange('max', parseFloat(e.target.value) || 100)}
                className="form-input"
              />
            </div>
          </div>
        );
      
      case 'normal':
        return (
          <div className="form-row">
            <div className="form-group">
              <label>Mean:</label>
              <input 
                type="number"
                step="0.01"
                value={config.mean || 0}
                onChange={(e) => onConfigChange('mean', parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Std Dev:</label>
              <input 
                type="number"
                step="0.01"
                value={config.stdDev || 1}
                onChange={(e) => onConfigChange('stdDev', parseFloat(e.target.value) || 1)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Min:</label>
              <input 
                type="number"
                step="0.01"
                value={config.min || 0}
                onChange={(e) => onConfigChange('min', parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Max:</label>
              <input 
                type="number"
                step="0.01"
                value={config.max || 100}
                onChange={(e) => onConfigChange('max', parseFloat(e.target.value) || 100)}
                className="form-input"
              />
            </div>
          </div>
        );
      
      case 'sine':
        return (
          <div className="form-row">
            <div className="form-group">
              <label>Min:</label>
              <input 
                type="number"
                step="0.01"
                value={config.min || 0}
                onChange={(e) => onConfigChange('min', parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Max:</label>
              <input 
                type="number"
                step="0.01"
                value={config.max || 100}
                onChange={(e) => onConfigChange('max', parseFloat(e.target.value) || 100)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Frequency (Hz):</label>
              <input 
                type="number"
                step="0.001"
                value={config.frequency || 0.1}
                onChange={(e) => onConfigChange('frequency', parseFloat(e.target.value) || 0.1)}
                className="form-input"
              />
            </div>
          </div>
        );
      
      case 'exponential':
        return (
          <div className="form-row">
            <div className="form-group">
              <label>Lambda:</label>
              <input 
                type="number"
                step="0.01"
                value={config.lambda || 1}
                onChange={(e) => onConfigChange('lambda', parseFloat(e.target.value) || 1)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Min:</label>
              <input 
                type="number"
                step="0.01"
                value={config.min || 0}
                onChange={(e) => onConfigChange('min', parseFloat(e.target.value) || 0)}
                className="form-input"
              />
            </div>
            <div className="form-group">
              <label>Max:</label>
              <input 
                type="number"
                step="0.01"
                value={config.max || 100}
                onChange={(e) => onConfigChange('max', parseFloat(e.target.value) || 100)}
                className="form-input"
              />
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  const renderBooleanFields = () => {
    switch (generator) {
      case 'static':
        return (
          <div className="form-group">
            <label>Value:</label>
            <select 
              value={config.value ? 'true' : 'false'}
              onChange={(e) => onConfigChange('value', e.target.value === 'true')}
              className="form-input"
            >
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          </div>
        );
      
      case 'probability':
        return (
          <div className="form-group">
            <label>True Probability (0-1):</label>
            <input 
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={config.trueProbability || 0.5}
              onChange={(e) => onConfigChange('trueProbability', parseFloat(e.target.value) || 0.5)}
              className="form-input"
            />
          </div>
        );
      
      case 'pattern':
        return (
          <div className="form-group">
            <label>Pattern Sequence:</label>
            <div className="pattern-editor">
              {(config.sequence || []).map((value, index) => (
                <div key={index} className="pattern-item">
                  <select 
                    value={value ? 'true' : 'false'}
                    onChange={(e) => {
                      const newSequence = [...(config.sequence || [])];
                      newSequence[index] = e.target.value === 'true';
                      onConfigChange('sequence', newSequence);
                    }}
                    className="form-input"
                  >
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                  <button 
                    type="button"
                    onClick={() => {
                      const newSequence = [...(config.sequence || [])];
                      newSequence.splice(index, 1);
                      onConfigChange('sequence', newSequence);
                    }}
                    className="btn btn-sm btn-danger remove-pattern-btn"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button 
                type="button"
                onClick={() => {
                  const newSequence = [...(config.sequence || []), true];
                  onConfigChange('sequence', newSequence);
                }}
                className="btn btn-sm btn-success add-pattern-btn"
              >
                Add Step
              </button>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  const renderStringFields = () => {
    switch (generator) {
      case 'static':
        return (
          <div className="form-group">
            <label>Value:</label>
            <input 
              type="text"
              value={config.value || ''}
              onChange={(e) => onConfigChange('value', e.target.value)}
              className="form-input"
            />
          </div>
        );
      
      case 'list':
      case 'random':
        return (
          <div className="form-group">
            <label>Values:</label>
            <div className="string-list-editor">
              {(config.values || []).map((value, index) => (
                <div key={index} className="string-list-item">
                  <input 
                    type="text"
                    value={value}
                    onChange={(e) => {
                      const newValues = [...(config.values || [])];
                      newValues[index] = e.target.value;
                      onConfigChange('values', newValues);
                    }}
                    className="form-input"
                  />
                  <button 
                    type="button"
                    onClick={() => {
                      const newValues = [...(config.values || [])];
                      newValues.splice(index, 1);
                      onConfigChange('values', newValues);
                    }}
                    className="btn btn-sm btn-danger remove-value-btn"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button 
                type="button"
                onClick={() => {
                  const newValues = [...(config.values || []), ''];
                  onConfigChange('values', newValues);
                }}
                className="btn btn-sm btn-success add-value-btn"
              >
                Add Value
              </button>
            </div>
          </div>
        );
      
      case 'weighted':
        return (
          <div className="form-group">
            <label>Weighted Values:</label>
            <div className="weighted-list-editor">
              {(config.weightedValues || []).map((item, index) => (
                <div key={index} className="weighted-list-item">
                  <input 
                    type="text"
                    placeholder="Value"
                    value={item.value}
                    onChange={(e) => {
                      const newValues = [...(config.weightedValues || [])];
                      newValues[index] = { ...newValues[index], value: e.target.value };
                      onConfigChange('weightedValues', newValues);
                    }}
                    className="form-input"
                  />
                  <input 
                    type="number"
                    placeholder="Weight"
                    min="0"
                    step="0.1"
                    value={item.weight}
                    onChange={(e) => {
                      const newValues = [...(config.weightedValues || [])];
                      newValues[index] = { ...newValues[index], weight: parseFloat(e.target.value) || 1 };
                      onConfigChange('weightedValues', newValues);
                    }}
                    className="form-input"
                  />
                  <button 
                    type="button"
                    onClick={() => {
                      const newValues = [...(config.weightedValues || [])];
                      newValues.splice(index, 1);
                      onConfigChange('weightedValues', newValues);
                    }}
                    className="btn btn-sm btn-danger remove-value-btn"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button 
                type="button"
                onClick={() => {
                  const newValues = [...(config.weightedValues || []), { value: '', weight: 1 }];
                  onConfigChange('weightedValues', newValues);
                }}
                className="btn btn-sm btn-success add-value-btn"
              >
                Add Weighted Value
              </button>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  switch (dataType) {
    case 'number':
      return renderNumberFields();
    case 'boolean':
      return renderBooleanFields();
    case 'string':
    case 'enum':
      return renderStringFields();
    default:
      return null;
  }
}

// Helper function to format preview values
function formatPreviewValue(previewValue) {
  if (!previewValue) return 'N/A';
  return JSON.stringify(previewValue, null, 2);
}

export default SimulationPanel;