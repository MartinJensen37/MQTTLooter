import React, { useState, useEffect, useRef } from 'react';
import './SimulationPanel.css';
import { SimulationEngine, type SimulationSample } from '../../services/SimulationEngine';
import { loadDevices, nextId, presetOutputs } from './simulationPanel/model';
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

function SimulationWorkspace({
  connectionId,
  onPublishMessage,
  isConnected,
  selectedTopic,
  showFeedback,
}: SimulationPanelProps) {
  const [loaded] = useState(() => {
    try {
      return {
        devices: loadDevices(localStorage.getItem(`mqtt-simulation-devices-${connectionId}`)),
        error: '',
      };
    } catch (error) {
      return {
        devices: [],
        error: `Saved devices could not be loaded: ${(error as Error).message} Original settings have been kept.`,
      };
    }
  });
  const [simulatedDevices, setSimulatedDevices] = useState<SimulatedDevice[]>(loaded.devices);
  const [samples, setSamples] = useState<
    Record<number, Record<number, Pick<SimulationSample, 'payload' | 'topic' | 'payloadMode'>>>
  >({});
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const engineRef = useRef<SimulationEngine | null>(null);
  const callbacks = useRef({ onPublishMessage, showFeedback });
  callbacks.current = { onPublishMessage, showFeedback };
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [showEditOutput, setShowEditOutput] = useState(false);
  const [editingOutput, setEditingOutput] = useState<DeviceOutput | null>(null);

  useEffect(() => {
    const engine = new SimulationEngine({
      publish: (message) => callbacks.current.onPublishMessage(message),
      sample: (id, sample) =>
        setSamples((previous) => ({
          ...previous,
          [id]: {
            ...previous[id],
            ...Object.fromEntries(
              Object.keys(sample.values).map((outputId) => [
                outputId,
                {
                  payload: sample.payload,
                  payloadMode: sample.payloadMode,
                  topic: sample.topic,
                },
              ]),
            ),
          },
        })),
      busy: (id, value) => setBusy((previous) => ({ ...previous, [id]: value })),
      error: (id, message) => {
        setSimulatedDevices((previous) =>
          previous.map((device) =>
            device.id === id ? { ...device, isPublishing: false } : device,
          ),
        );
        callbacks.current.showFeedback?.(`Simulation stopped: ${message}`, 'error');
      },
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.sync(simulatedDevices, isConnected);
    if (!isConnected && simulatedDevices.some((device) => device.isPublishing)) {
      setSimulatedDevices((previous) =>
        previous.map((device) => ({ ...device, isPublishing: false })),
      );
    }
  }, [simulatedDevices, isConnected]);

  useEffect(() => {
    if (loaded.error) return;
    try {
      localStorage.setItem(
        `mqtt-simulation-devices-${connectionId}`,
        JSON.stringify(
          simulatedDevices.map((device) => ({
            ...device,
            schemaVersion: 1,
            isPublishing: false,
            outputs: device.outputs.map((output) => ({ ...output, currentValue: undefined })),
          })),
        ),
      );
    } catch {
      callbacks.current.showFeedback?.('Simulation settings could not be saved locally.', 'error');
    }
  }, [simulatedDevices, connectionId, loaded.error]);

  const createNewDevice = (deviceData: {
    name: string;
    topic: string;
    publishInterval: number;
    preset?: string;
  }) => {
    const device: SimulatedDevice = {
      ...deviceData,
      schemaVersion: 1,
      payloadMode: 'json',
      id: nextId(simulatedDevices),
      isPublishing: false,
      outputs: presetOutputs(deviceData.preset ?? 'sensor'),
      qos: 0,
      retain: false,
      payloadFormat: 'named',
      publishMode: 'signals',
    };
    setSimulatedDevices((previous) => [...previous, device]);
    setSelectedDevice(device.id);
    setShowAddDevice(false);
  };

  const deleteDevice = (deviceId: number) => {
    engineRef.current?.stop(deviceId);
    setSamples((previous) => {
      const next = { ...previous };
      delete next[deviceId];
      return next;
    });
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

  const publishOnce = (deviceId: number) => {
    void engineRef.current?.publishOnce(deviceId);
  };

  const togglePublishing = (deviceId: number) => {
    const device = simulatedDevices.find((d) => d.id === deviceId);
    if (device && (device.isPublishing || isConnected)) {
      if (device.isPublishing) engineRef.current?.stop(deviceId);
      updateDevice(deviceId, { isPublishing: !device.isPublishing });
    }
  };

  const addOutput = (deviceId: number) => {
    const device = simulatedDevices.find((item) => item.id === deviceId);
    if (!device) return;
    let name = 'signal';
    let index = 1;
    while (device.outputs.some((output) => output.name === name)) name = `signal_${index++}`;
    const output: DeviceOutput = {
      id: nextId(device.outputs),
      name,
      dataType: 'number',
      generator: 'static',
      config: { value: 0 },
      decimalPrecision: 2,
      includeTimestamp: true,
    };
    setEditingOutput(output);
    setShowEditOutput(true);
  };

  const removeOutput = (deviceId: number, outputId: number) => {
    const device = simulatedDevices.find((d) => d.id === deviceId);
    if (device) {
      updateDevice(deviceId, { outputs: device.outputs.filter((o) => o.id !== outputId) });
      setSamples((previous) => {
        const remaining = { ...previous[deviceId] };
        delete remaining[outputId];
        return { ...previous, [deviceId]: remaining };
      });
    }
  };

  const selectedConfig = getSelectedDeviceData();
  const duplicateDevice = () => {
    if (!selectedConfig) return;
    const copy = {
      ...selectedConfig,
      id: nextId(simulatedDevices),
      name: `${selectedConfig.name} copy`,
      isPublishing: false,
      outputs: selectedConfig.outputs.map((output) => ({
        ...output,
        config: structuredClone(output.config),
      })),
    };
    setSimulatedDevices((previous) => [...previous, copy]);
    setSelectedDevice(copy.id);
  };

  return (
    <div className="simulation-panel">
      {loaded.error && <p role="alert">{loaded.error}</p>}
      <div className="simulation-content">
        {/* Device sidebar */}
        <div className="device-sidebar">
          <div className="device-sidebar-header">
            <h3>Simulated Devices</h3>
            <button
              disabled={!!loaded.error}
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
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedDevice === device.id}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === 'Enter' || event.key === ' ')
                    ) {
                      event.preventDefault();
                      setSelectedDevice(device.id);
                    }
                  }}
                >
                  <div className="device-info">
                    <i
                      className={`fas fa-${device.isPublishing ? 'broadcast-tower' : 'microchip'} device-icon ${device.isPublishing ? 'publishing' : ''}`}
                    ></i>
                    <div>
                      <span className="device-name">{device.name}</span>
                      <small className="device-summary">
                        {device.outputs.length} signals /{' '}
                        {device.isPublishing ? 'Running' : 'Stopped'}
                      </small>
                      <small className="device-summary">{device.topic}</small>
                    </div>
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
          {selectedConfig ? (
            <DeviceConfigPanel
              key={selectedConfig.id}
              busy={!!busy[selectedConfig.id]}
              onDuplicate={duplicateDevice}
              device={selectedConfig}
              onUpdateDevice={updateDevice}
              onPublishOnce={publishOnce}
              onTogglePublishing={togglePublishing}
              onAddOutput={addOutput}
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

      {showEditOutput && editingOutput && selectedConfig && (
        <EditOutputModal
          output={editingOutput}
          otherOutputs={selectedConfig!.outputs}
          device={selectedConfig}
          lastPublished={samples[selectedConfig.id]?.[editingOutput.id]}
          onRemove={
            selectedConfig!.outputs.length > 1 &&
            selectedConfig!.outputs.some((output) => output.id === editingOutput.id)
              ? () => {
                  removeOutput(selectedConfig.id, editingOutput.id);
                  setShowEditOutput(false);
                  setEditingOutput(null);
                }
              : undefined
          }
          onClose={() => {
            setShowEditOutput(false);
            setEditingOutput(null);
          }}
          onSave={(updatedOutput: any) => {
            updateDevice(selectedConfig.id, {
              outputs: selectedConfig!.outputs.some((output) => output.id === editingOutput.id)
                ? selectedConfig!.outputs.map((output) =>
                    output.id === editingOutput.id ? { ...output, ...updatedOutput } : output,
                  )
                : [...selectedConfig!.outputs, updatedOutput],
            });
            setShowEditOutput(false);
            setEditingOutput(null);
          }}
        />
      )}
    </div>
  );
}

export default function SimulationPanel(props: SimulationPanelProps) {
  return <SimulationWorkspace key={props.connectionId ?? 'none'} {...props} />;
}
