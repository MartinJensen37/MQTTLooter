// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnections } from '../src/renderer/src/hooks/useConnections';
import RecordingPanel from '../src/renderer/src/components/RecordingPanel/RecordingPanel';
import SimulationPanel from '../src/renderer/src/components/SimulationPanel/SimulationPanel';
import MQTTService from '../src/renderer/src/services/MQTTService';
import { fakeRecordingApi } from './fake-recordings';

const events = vi.hoisted(() => new Map<string, Set<(data: any) => void>>());
vi.mock('../src/renderer/src/services/MQTTService', () => ({
  default: {
    onAny: (event, handler) => {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(handler);
    },
    off: (_id, event, handler) => events.get(event)?.delete(handler),
    refreshConnectionsFromMain: vi.fn(),
    adoptConnection: vi.fn(),
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
    </>
  ),
}));

let container: HTMLDivElement;
let root: Root;
const feedback = vi.fn();
let recordings: ReturnType<typeof fakeRecordingApi>;
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
  recordings = fakeRecordingApi();
  Object.assign(window, { electronAPI: { recordings: recordings.api } });
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
// Let chained IPC promises and timers settle under fake timers.
const settle = async (ms = 0) => {
  for (let i = 0; i < 5; i++) await act(async () => vi.advanceTimersByTimeAsync(i ? 0 : ms));
};

describe('renderer state', () => {
  it('records in main and keeps recording when another connection is selected', async () => {
    const props = { connectionName: 'Broker A', isConnected: true, showFeedback: feedback };
    const render = (id: string) =>
      act(async () =>
        root.render(
          <StrictMode>
            <RecordingPanel {...props} activeConnectionId={id} />
          </StrictMode>,
        ),
      );
    await render('a');
    await settle();
    await click('Record');
    await settle();
    expect(recordings.api.start).toHaveBeenCalledWith('a', 'Broker A', expect.any(String));
    recordings.capture(
      'a',
      Array.from({ length: 500 }, (_, i) => ({ topic: 'a/b', message: `m${i}` })),
    );
    await render('b');
    await settle(500);
    // Selecting another connection no longer stops the capture.
    expect(recordings.api.stop).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Also recording 1 other connection');
    await render('a');
    await settle(500);
    expect(container.querySelector('.recording-live-info')?.textContent).toContain('Messages: 500');
    await click('Stop');
    await settle();
    expect(recordings.api.stop).toHaveBeenCalledWith('a');
    const [saved] = recordings.list();
    expect(saved).toMatchObject({
      state: 'complete',
      messageCount: 500,
      connectionName: 'Broker A',
    });
    expect(container.querySelector('.recording-item-stats')?.textContent).toContain('500 messages');
  });

  it('keeps corrupt legacy data and blocks recording until storage is available', async () => {
    localStorage.setItem('mqtt-recordings', 'broken JSON');
    await act(async () => root.render(<RecordingPanel activeConnectionId="a" isConnected />));
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(
      (container.querySelector('.recording-action-buttons button') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(localStorage.getItem('mqtt-recordings')).toBe('broken JSON');
    expect(recordings.api.migrate).not.toHaveBeenCalled();
  });

  it('keeps legacy recordings until migration succeeds', async () => {
    const legacy = JSON.stringify([
      {
        id: 1,
        name: 'Legacy',
        startTime: 0,
        endTime: 1,
        messages: [{ topic: 't', message: 'x', timestamp: 0 }],
      },
    ]);
    localStorage.setItem('mqtt-recordings', legacy);
    recordings.api.migrate.mockResolvedValueOnce({ success: false, error: 'Disk full' });
    await act(async () => root.render(<RecordingPanel />));
    await settle();
    expect(container.textContent).toContain('Disk full');
    expect(localStorage.getItem('mqtt-recordings')).toBe(legacy);
    await click('Retry storage');
    await settle();
    expect(localStorage.getItem('mqtt-recordings')).toBeNull();
    expect(container.textContent).toContain('Legacy');
    expect(recordings.list()).toHaveLength(1);
  });

  it('reports a capture that main stopped on its own', async () => {
    await act(async () =>
      root.render(<RecordingPanel activeConnectionId="a" isConnected showFeedback={feedback} />),
    );
    await settle();
    await click('Record');
    await settle();
    recordings.stopWithNotice('a', 'Recording storage limit reached.');
    await settle(500);
    expect(feedback).toHaveBeenCalledWith(
      'Recording stopped: Recording storage limit reached.',
      'error',
    );
    expect(container.textContent).toContain('Incomplete capture: Recording storage limit reached.');
    expect(container.querySelector('.recording-action-buttons button')?.textContent).toContain(
      'Record',
    );
  });

  it('moves saved secrets into encrypted storage only when the OS can encrypt', async () => {
    const saved = [
      { id: 'a', config: { name: 'A', password: 'hunter2', tls: { enabled: false, key: null } } },
      { id: 'b', config: { name: 'B' } },
    ];
    const credentials = (available: boolean) => ({
      status: vi.fn(async () => ({ success: true, data: { available, stored: {} } })),
      get: vi.fn(),
      set: vi.fn(async () => ({ success: true })),
    });
    function Harness() {
      useConnections(feedback, null, () => {});
      return null;
    }
    for (const available of [false, true]) {
      localStorage.setItem('mqtt-connections', JSON.stringify(saved));
      const api = credentials(available);
      Object.assign(window.electronAPI, { credentials: api });
      await act(async () => root.render(<Harness key={String(available)} />));
      await settle();
      const stored = localStorage.getItem('mqtt-connections')!;
      if (!available) {
        // Without OS encryption, nothing moves and nothing is lost.
        expect(api.set).not.toHaveBeenCalled();
        expect(stored).toContain('hunter2');
      } else {
        expect(api.set).toHaveBeenCalledOnce();
        expect(api.set).toHaveBeenCalledWith('a', { password: 'hunter2' });
        expect(stored).not.toContain('hunter2');
        expect(JSON.parse(stored).map((c: any) => c.config.name)).toEqual(['A', 'B']);
      }
    }
  });

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

  it('keeps playback on the recorded schedule when publishes are slow', async () => {
    recordings.import({
      name: 'Timed',
      startTime: 0,
      endTime: 3000,
      connectionName: 'A',
      messages: [0, 1000, 2000, 3000].map((timestamp) => ({
        topic: 't',
        message: String(timestamp),
        timestamp,
      })),
    });
    const started = Date.now();
    const sent: number[] = [];
    // Each acknowledgement takes 400 ms; waiting for it must not delay later messages.
    const publish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          sent.push(Date.now() - started);
          setTimeout(resolve, 400);
        }),
    );
    await act(async () =>
      root.render(<RecordingPanel activeConnectionId="a" isConnected onPublishMessage={publish} />),
    );
    await settle();
    await act(async () =>
      (container.querySelector('.recording-item-header') as HTMLElement).click(),
    );
    await settle();
    await act(async () =>
      (container.querySelector('.recording-republish input') as HTMLInputElement).click(),
    );
    await act(async () =>
      (container.querySelector('[title="Start playback"]') as HTMLButtonElement).click(),
    );
    for (let i = 0; i < 40; i++) await settle(100);
    expect(sent).toEqual([0, 1000, 2000, 3000]);
  });

  it('plays offline by default and publishes each message once when enabled', async () => {
    recordings.import({
      name: 'Saved',
      startTime: 1000,
      endTime: 2000,
      connectionName: 'A',
      messages: [
        { topic: 'a', message: 'hello', timestamp: 1000 },
        { topic: 'a', message: '/wAB', encoding: 'base64', timestamp: 2000 },
      ],
    });
    const publish = vi.fn().mockResolvedValue(undefined);
    await act(async () =>
      root.render(
        <StrictMode>
          <RecordingPanel activeConnectionId="a" isConnected onPublishMessage={publish} />
        </StrictMode>,
      ),
    );
    await settle();
    await act(async () =>
      (container.querySelector('.recording-item-header') as HTMLElement).click(),
    );
    await settle();
    const start = async () =>
      act(async () =>
        (container.querySelector('[title="Start playback"]') as HTMLButtonElement).click(),
      );
    await start();
    await settle();
    await settle(1000);
    expect(publish).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Message 2 of 2');
    await act(async () =>
      (container.querySelector('.recording-republish input') as HTMLInputElement).click(),
    );
    await start();
    await settle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
    await settle(1000);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: '/wAB', encoding: 'base64' }),
    );
    expect(container.querySelector('.recording-payload-content')?.textContent).toBe('ff 00 01');
    expect(vi.getTimerCount()).toBe(1); // Only the recording status poll remains.
  });
});

describe('recording import', () => {
  it('imports through main and reports the result or a cancelled dialog', async () => {
    await act(async () =>
      root.render(<RecordingPanel activeConnectionId="a" isConnected showFeedback={feedback} />),
    );
    await settle();
    await click('Load Recording');
    await settle();
    expect(feedback).not.toHaveBeenCalled();
    recordings.chooseImport({
      recordingInfo: { name: 'From file', startTime: 0, endTime: 1 },
      messages: [
        { topic: 'a', payload: '1', timestamp: 0 },
        { topic: 'a', payload: '2', timestamp: 1 },
      ],
    });
    await click('Load Recording');
    await settle();
    expect(feedback).toHaveBeenCalledWith('Recording imported: 2 messages.', 'success');
    expect(container.textContent).toContain('From file');
  });
});
