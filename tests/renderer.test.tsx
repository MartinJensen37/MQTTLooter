// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnections } from '../src/renderer/src/hooks/useConnections';
import RecordingPanel from '../src/renderer/src/components/RecordingPanel/RecordingPanel';
import SimulationPanel from '../src/renderer/src/components/SimulationPanel/SimulationPanel';
import MQTTService from '../src/renderer/src/services/MQTTService';

const events = vi.hoisted(() => new Map<string, Set<(data: any) => void>>());
vi.mock('../src/renderer/src/services/MQTTService', () => ({
  default: {
    onAny: (event, handler) => {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(handler);
    },
    off: (_id, event, handler) => events.get(event)?.delete(handler),
    refreshConnectionsFromMain: vi.fn(),
    getAllConnections: vi.fn(() => []),
  },
}));
vi.mock('../src/renderer/src/services/TopicTreeService', () => ({
  default: { removeTopicTree: vi.fn() },
}));

// Exercise the scheduling container independently of the device editor markup.
vi.mock('../src/renderer/src/components/SimulationPanel/simulationPanel/DeviceConfigPanel', () => ({
  default: ({ device, onUpdateDevice, onTogglePublishing }) => (
    <>
      <button onClick={() => onTogglePublishing(device.id)}>Toggle simulation</button>
      <button
        onClick={() =>
          onUpdateDevice(device.id, {
            topic: 'edited',
            outputs: device.outputs.map((o) => ({ ...o, config: { value: 9 } })),
          })
        }
      >
        Edit simulation
      </button>
      <span>{device.outputs.map((o) => o.currentValue).join(',')}</span>
    </>
  ),
}));

let container: HTMLDivElement;
let root: Root;
const feedback = vi.fn();
const emit = (event: string, data: any) => events.get(event)?.forEach((handler) => handler(data));
const click = async (text: string) => {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  expect(button, `button ${text}`).toBeTruthy();
  await act(async () => button!.click());
};

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  localStorage.clear();
  events.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('renderer state', () => {
  it('preserves saved profiles on mount and refresh in StrictMode', async () => {
    localStorage.setItem(
      'mqtt-connections',
      JSON.stringify([
        { id: 'a', config: { name: 'A' } },
        { id: 'b', config: { name: 'B' } },
      ]),
    );
    let state: ReturnType<typeof useConnections>;
    function Harness() {
      state = useConnections(feedback, null, () => {});
      return null;
    }
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
    vi.mocked(MQTTService.refreshConnectionsFromMain).mockResolvedValue({
      a: { isConnected: true, subscriptions: { '#': {} } },
    });
    await act(async () => state!.updateConnectionsList());
    expect(state!.connections.map((c) => c.id)).toEqual(['a', 'b']);
    expect(state!.connections[0].subscriptions).toEqual(['#']);
    expect(JSON.parse(localStorage.getItem('mqtt-connections')!).length).toBe(2);
  });

  it('records a burst immediately, filters other brokers and stops on broker switches', async () => {
    const props = {
      connectionName: 'Broker A',
      activeConnectionId: 'a',
      isConnected: true,
      showFeedback: feedback,
    };
    await act(async () =>
      root.render(
        <StrictMode>
          <RecordingPanel {...props} />
        </StrictMode>,
      ),
    );
    await click('Record');
    await act(async () => {
      for (let i = 0; i < 500; i++)
        emit('message', {
          id: 'a',
          topic: 'a/b',
          message: `m${i}`,
          timestamp: Date.now(),
          qos: 1,
          retain: true,
        });
      emit('message', { id: 'b', topic: 'other', message: 'excluded', timestamp: Date.now() });
    });
    // No timer flush: stop must use the actual capture rather than a stale UI snapshot.
    await act(async () =>
      root.render(
        <StrictMode>
          <RecordingPanel {...props} activeConnectionId="b" connectionName="Broker B" />
        </StrictMode>,
      ),
    );
    const recordings = JSON.parse(localStorage.getItem('mqtt-recordings')!);
    expect(recordings).toHaveLength(1);
    expect(recordings[0].messageCount).toBe(500);
    expect(recordings[0].connectionName).toBe('Broker A');
    expect(recordings[0].messages[499].message).toBe('m499');
  });

  it('uses updated simulation settings and cancels timers on unmount', async () => {
    const outputs = [1, 2].map((id) => ({
      id,
      name: `out${id}`,
      dataType: 'number',
      generator: 'static',
      config: { value: id },
      currentValue: 0,
      includeTimestamp: false,
    }));
    localStorage.setItem(
      'mqtt-simulation-devices-a',
      JSON.stringify([{ id: 1, name: 'Device', topic: 'original', publishInterval: 100, outputs }]),
    );
    const publish = vi.fn().mockResolvedValue(undefined);
    await act(async () =>
      root.render(<SimulationPanel connectionId="a" isConnected onPublishMessage={publish} />),
    );
    await act(async () => (container.querySelector('.device-item') as HTMLElement).click());
    await click('Toggle simulation');
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        topic: 'original',
        payload: '{"out1":{"value":1},"out2":{"value":2}}',
      }),
    );
    expect(container.textContent).toContain('1,2');
    await click('Edit simulation');
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        topic: 'edited',
        payload: '{"out1":{"value":9},"out2":{"value":9}}',
      }),
    );
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('plays offline by default and publishes each message once when enabled', async () => {
    localStorage.setItem(
      'mqtt-recordings',
      JSON.stringify([
        {
          id: 1,
          name: 'Saved',
          startTime: 1000,
          endTime: 2000,
          connectionName: 'A',
          messages: [1000, 2000].map((timestamp) => ({ topic: 'a', message: 'hello', timestamp })),
        },
      ]),
    );
    const publish = vi.fn().mockResolvedValue(undefined);
    await act(async () =>
      root.render(
        <StrictMode>
          <RecordingPanel activeConnectionId="a" isConnected onPublishMessage={publish} />
        </StrictMode>,
      ),
    );
    await act(async () =>
      (container.querySelector('.recording-item-header') as HTMLElement).click(),
    );
    const start = async () =>
      act(async () =>
        (container.querySelector('[title="Start playback"]') as HTMLButtonElement).click(),
      );
    await start();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(publish).not.toHaveBeenCalled();
    await act(async () =>
      (
        container.querySelector('label.recording-controls-section input') as HTMLInputElement
      ).click(),
    );
    await start();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(publish).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1); // Only the recording UI poll remains.
  });
});
