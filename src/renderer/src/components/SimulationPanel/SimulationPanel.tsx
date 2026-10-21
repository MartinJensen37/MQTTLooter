import React, { useState, useEffect, useRef } from 'react';
import './SimulationPanel.css';
import { generateValue } from '../../utils/valueGenerators';
import type { SimulatedDevice, DeviceOutput } from './simulationPanel/types';
import DeviceConfigPanel from './simulationPanel/DeviceConfigPanel';
import AddDeviceModal from './simulationPanel/AddDeviceModal';
import EditOutputModal from './simulationPanel/EditOutputModal';

interface SimulationPanelProps {
  connectionId?: string | null;
  onPublishMessage: (data: any) => Promise<void> | void;
  showFeedback?: (message: string, type?: string) => void;
  isConnected: boolean;
  selectedTopic?: any;
}

function SimulationPanel({
  connectionId,
  onPublishMessage,
  isConnected,
  selectedTopic,
  showFeedback,
}: SimulationPanelProps) {
  const [simulatedDevices, setSimulatedDevices] = useState<SimulatedDevice[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(`mqtt-simulation-devices-${connectionId}`) || '[]',
      );
      return saved.map((device: SimulatedDevice) => ({ ...device, isPublishing: false }));
    } catch {
      return [];
    }
  });
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [showEditOutput, setShowEditOutput] = useState(false);
  const [editingOutput, setEditingOutput] = useState<DeviceOutput | null>(null);

  const publishIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const publishOnceRef = useRef<(id: number) => void>(() => {});
  const schedule = simulatedDevices
    .filter((d) => d.isPublishing)
    .map((d) => `${d.id}:${Math.max(100, d.publishInterval)}`)
    .join(',');

  useEffect(() => {
    try {
      localStorage.setItem(
        `mqtt-simulation-devices-${connectionId}`,
        JSON.stringify(simulatedDevices),
      );
    } catch {
      showFeedback?.('Simulation settings could not be saved locally.', 'error');
    }
  }, [simulatedDevices, connectionId, showFeedback]);

  useEffect(() => {
    if (!isConnected || !schedule) return;
    const intervals = publishIntervalsRef.current;
    for (const entry of schedule.split(',')) {
      const [id, interval] = entry.split(':').map(Number);
      intervals[id] = setInterval(() => publishOnceRef.current(id), interval);
    }
    return () => {
      Object.values(intervals).forEach(clearInterval);
      Object.keys(intervals).forEach((id) => delete intervals[id]);
    };
  }, [isConnected, schedule]);

  const createNewDevice = (deviceData: {
    name: string;
    topic: string;
    publishInterval?: number;
  }) => {
    const newDevice: SimulatedDevice = {
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
          config: { mean: 21.5, stdDev: 1.5, min: 18, max: 25 },
          currentValue: 21.5,
        },
      ],
    };

    setSimulatedDevices((prev) => [...prev, newDevice]);
    setSelectedDevice(newDevice.id);
    setShowAddDevice(false);
  };

  const deleteDevice = (deviceId: number) => {
    if (publishIntervalsRef.current[deviceId]) {
      clearInterval(publishIntervalsRef.current[deviceId]);
      delete publishIntervalsRef.current[deviceId];
    }

    setSimulatedDevices((prev) => prev.filter((d) => d.id !== deviceId));

    if (selectedDevice === deviceId) {
      const remaining = simulatedDevices.filter((d) => d.id !== deviceId);
      setSelectedDevice(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const getSelectedDeviceData = () => simulatedDevices.find((d) => d.id === selectedDevice);

  const updateDevice = (deviceId: number, updates: any) => {
    setSimulatedDevices((prev) =>
      prev.map((device) => (device.id === deviceId ? { ...device, ...updates } : device)),
    );
  };

  const generatePayload = (device: SimulatedDevice): string => {
    const payload: Record<string, any> = {};

    const outputs = device.outputs.map((output) => {
      const value = generateValue(output);

      const outputPayload: any = { value };
      if (output.dataType === 'number' && output.unit && output.unit.trim()) {
        outputPayload.unit = output.unit.trim();
      }
      if (output.includeTimestamp !== false) {
        outputPayload.timestamp = new Date().toISOString();
      }
      payload[output.name] = outputPayload;
      return { ...output, currentValue: value };
    });
    updateDevice(device.id, { outputs });

    // Flatten when there's a single output.
    const outputNames = Object.keys(payload);
    if (outputNames.length === 1) return JSON.stringify(payload[outputNames[0]]);
    return JSON.stringify(payload);
  };

  const publishOnce = async (deviceId: number) => {
    const device = simulatedDevices.find((d) => d.id === deviceId);
    if (!device || !isConnected) return;
    try {
      await onPublishMessage({
        topic: device.topic,
        payload: generatePayload(device),
        qos: 0,
        retain: false,
      });
    } catch (error) {
      updateDevice(deviceId, { isPublishing: false });
      showFeedback?.(`Simulation publish failed: ${(error as Error).message}`, 'error');
    }
  };

  useEffect(() => {
    publishOnceRef.current = publishOnce;
  });

  const togglePublishing = (deviceId: number) => {
    const device = simulatedDevices.find((d) => d.id === deviceId);
    if (device && (device.isPublishing || isConnected)) {
      updateDevice(deviceId, { isPublishing: !device.isPublishing });
    }
  };

  const addOutput = (deviceId: number) => {
    const newOutput: DeviceOutput = {
      id: Date.now(),
      name: 'new_sensor',
      dataType: 'number',
      generator: 'normal',
      unit: '',
      decimalPrecision: 2,
      includeTimestamp: true,
      config: { mean: 50, stdDev: 10, min: 0, max: 100 },
      currentValue: 50,
    };

    const device = simulatedDevices.find((d) => d.id === deviceId);
    if (device) {
      updateDevice(deviceId, { outputs: [...device.outputs, newOutput] });
    }
  };

  const removeOutput = (deviceId: number, outputId: number) => {
    const device = simulatedDevices.find((d) => d.id === deviceId);
    if (device) {
      updateDevice(deviceId, { outputs: device.outputs.filter((o) => o.id !== outputId) });
    }
  };

  const selectedDeviceData = getSelectedDeviceData();

  return (
    <div className="simulation-panel">
      <div className="simulation-content">
        {/* Device sidebar */}
        <div className="device-sidebar">
          <div className="device-sidebar-header">
            <h3>Simulated Devices</h3>
            <button
              onClick={() => setShowAddDevice(true)}
              className="btn btn-sm btn-primary"
              title="Add Simulated Device"
              style={{ borderRadius: 'var(--radius-pill)' }}
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
              simulatedDevices.map((device) => (
                <div
                  key={device.id}
                  className={`device-item ${selectedDevice === device.id ? 'selected' : ''}`}
                  onClick={() => setSelectedDevice(device.id)}
                >
                  <div className="device-info">
                    <i
                      className={`fas fa-${device.isPublishing ? 'broadcast-tower' : 'microchip'} device-icon ${device.isPublishing ? 'publishing' : ''}`}
                    ></i>
                    <span className="device-name">{device.name}</span>
                  </div>
                  <div className="device-actions">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDevice(device.id);
                      }}
                      className="btn btn-sm btn-danger"
                      title="Delete device"
                      style={{ borderRadius: 'var(--radius-pill)' }}
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Device configuration */}
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
          onSave={(updatedOutput: any) => {
            updateDevice(selectedDeviceData.id, {
              outputs: selectedDeviceData.outputs.map((o) =>
                o.id === editingOutput.id ? { ...o, ...updatedOutput } : o,
              ),
            });
            setShowEditOutput(false);
            setEditingOutput(null);
          }}
        />
      )}
    </div>
  );
}

export default SimulationPanel;
