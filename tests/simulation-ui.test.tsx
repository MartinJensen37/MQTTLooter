// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import SimulationPanel from '../src/renderer/src/components/SimulationPanel/SimulationPanel';
import EditOutputModal from '../src/renderer/src/components/SimulationPanel/simulationPanel/EditOutputModal';
import { sampleSignalPreview } from '../src/renderer/src/components/SimulationPanel/simulationPanel/signalPreview';

let root: Root;
let container: HTMLDivElement;
const click = async (name: string) => {
  const button = [...container.querySelectorAll('button')].find(
    (item) =>
      (item.getAttribute('aria-label') ||
        item.getAttribute('title') ||
        item.textContent?.trim()) === name,
  );
  expect(button, name).toBeTruthy();
  await act(async () => button!.click());
};
const input = async (label: string, value: string) => {
  const element = [...container.querySelectorAll('label')].find((item) =>
    item.textContent?.startsWith(label),
  );
  const field =
    element?.querySelector('input, select') ?? document.getElementById(element?.htmlFor ?? '');
  expect(field, label).toBeTruthy();
  await act(async () => {
    const prototype =
      field!.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field!.dispatchEvent(
      new Event(field!.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
    );
  });
};
const seed = (id: string) =>
  localStorage.setItem(
    `mqtt-simulation-devices-${id}`,
    JSON.stringify([
      {
        id: 1,
        name: `Device ${id}`,
        topic: id,
        publishInterval: 100,
        isPublishing: true,
        outputs: [
          {
            id: 1,
            name: 'value',
            dataType: 'number',
            generator: 'static',
            config: { value: 0 },
            decimalPrecision: 0,
            includeTimestamp: false,
          },
        ],
      },
    ]),
  );
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('keeps random mini-patterns repeatable without consuming live randomness or state', () => {
  const random = vi.spyOn(Math, 'random');
  const output = Object.freeze({
    id: 1,
    name: 'walk',
    dataType: 'number',
    generator: 'walk',
    config: Object.freeze({ start: 25, step: 2, min: 0, max: 100 }),
    currentValue: 75,
  });
  const first = sampleSignalPreview(output, true)!;
  expect(sampleSignalPreview(output, true)).toEqual(first);
  expect(first.points[0].y).toBe(25);
  expect(new Set(first.points.map((point) => point.y)).size).toBeGreaterThan(1);
  expect(random).not.toHaveBeenCalled();
  expect(output.currentValue).toBe(75);
});

it('constructs compact signal rows and keeps payload details inside the editor', async () => {
  await act(async () =>
    root.render(<SimulationPanel connectionId="a" isConnected onPublishMessage={vi.fn()} />),
  );
  await click('Add Simulated Device');
  await input('Start from', 'environment');
  await input('Device Name:', 'Room');
  await input('Topic prefix:', 'room');
  await click('Create Device');
  expect(container.textContent).toContain('Signals (3)');
  expect(container.querySelectorAll('.signal-overview-row')).toHaveLength(3);
  expect(container.querySelector('.device-config pre')).toBeNull();
  expect(container.querySelector('.signal-mode-pill')?.textContent).toBe('Sync');
  await click('Edit temperature');
  expect(container.querySelector('.preview-topic')?.textContent).toBe('room/temperature');
  expect(JSON.parse(container.querySelector('.preview-section pre')!.textContent!)).toHaveProperty(
    'value',
  );
  await click('Cancel');
  await click('Add Signal');
  await input('Signal name', 'temperature');
  expect(container.textContent).toContain('Signal names must be unique');
  expect(
    [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save Signal')
      ?.disabled,
  ).toBe(true);
  await click('Cancel');
  expect(container.textContent).toContain('Signals (3)');
  await click('Duplicate device');
  const devices = JSON.parse(localStorage.getItem('mqtt-simulation-devices-a')!);
  expect(devices).toHaveLength(2);
  expect(devices[1]).toMatchObject({
    name: 'Room copy',
    payloadFormat: 'named',
    publishMode: 'signals',
    isPublishing: false,
  });
  expect(devices[0].id).not.toBe(devices[1].id);
});

it('keeps zero precision and probability, rejects duplicate names and edits enum sequences', async () => {
  const save = vi.fn();
  const output = {
    id: 1,
    name: 'signal',
    dataType: 'number',
    generator: 'static',
    config: { value: 0 },
    decimalPrecision: 0,
    includeTimestamp: false,
  };
  await act(async () =>
    root.render(
      <EditOutputModal
        output={output}
        otherOutputs={[{ ...output, id: 2, name: 'taken' }]}
        onClose={vi.fn()}
        onSave={save}
      />,
    ),
  );
  expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('0');
  await input('Signal name', 'taken');
  expect(container.textContent).toContain('Signal names must be unique');
  await input('Signal name', 'signal');
  await input('Data type', 'boolean');
  await input('Generator', 'probability');
  await input('True probability', '0');
  expect(container.querySelector('pre')?.textContent).toContain('false');
  await click('Save Signal');
  expect(save.mock.calls[0][0].config.trueProbability).toBe(0);
  await input('Data type', 'enum');
  await input('Generator', 'pattern');
  await input('Time per step', '250');
  expect(container.querySelectorAll('.signal-list-row')).toHaveLength(3);
  await click('Save Signal');
  expect(save.mock.calls[1][0].config).toMatchObject({
    sequence: ['idle', 'running', 'idle'],
    intervalMs: 250,
  });
});

it('edits per-signal topics and schedules, previews three cycles, and publishes separate messages', async () => {
  const publish = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(<SimulationPanel connectionId="a" isConnected onPublishMessage={publish} />),
  );
  await click('Add Simulated Device');
  await input('Start from', 'environment');
  await input('Device Name:', 'Room');
  await input('Topic prefix:', 'room');
  await click('Create Device');
  await click('Edit temperature');
  await input('Signal topic', 'custom/temperature');
  await input('Timing mode', 'fixed');
  await input('Signal period (ms)', '2500');
  await input('Time offset (ms)', '250');
  await input('Publish probability (%)', '25');
  await input('Generator', 'sine');
  const plot = container.querySelector('.signal-dialog svg');
  expect(plot?.getAttribute('aria-label')).toContain('three cycles');
  expect(plot?.textContent).toContain('100');
  expect(plot?.textContent).toContain('0');
  await click('Save Signal');
  const saved = JSON.parse(localStorage.getItem('mqtt-simulation-devices-a')!)[0];
  expect(saved.outputs[0]).toMatchObject({
    topic: 'custom/temperature',
    timing: {
      mode: 'fixed',
      intervalMs: 2500,
      offsetMs: 250,
      probability: 0.25,
    },
  });
  await click('Publish Once');
  expect(publish.mock.calls.map(([message]) => message.topic)).toEqual([
    'custom/temperature',
    'room/humidity',
    'room/occupied',
  ]);
  expect(JSON.parse(publish.mock.calls[0][0].payload)).toHaveProperty('value');
  const row = container.querySelector('.signal-overview-row')!;
  expect(row.querySelector('.signal-interval-pill')?.textContent).toBe('2.5 s');
  expect(row.querySelector('.signal-mode-pill')?.textContent).toBe('Fixed');
  await click('Edit temperature');
  expect(container.querySelector('.last-published code')?.textContent).toBe('custom/temperature');
  expect(JSON.parse(container.querySelector('.last-published pre')!.textContent!)).toEqual(
    JSON.parse(publish.mock.calls[0][0].payload),
  );
  await click('Cancel');
  await click('Edit occupied');
  expect(container.querySelector('.last-published code')?.textContent).toBe('room/occupied');
  expect(JSON.parse(container.querySelector('.last-published pre')!.textContent!)).toEqual(
    JSON.parse(publish.mock.calls[2][0].payload),
  );
});

it('previews combined payloads without consuming live counter state and removes signals only in the editor', async () => {
  seed('a');
  const saved = JSON.parse(localStorage.getItem('mqtt-simulation-devices-a')!);
  saved[0].payloadFormat = 'named';
  saved[0].outputs[0].generator = 'counter';
  saved[0].outputs[0].config = { start: 0, step: 1, min: 0, max: 100 };
  saved[0].outputs.push({ ...saved[0].outputs[0], id: 2, name: 'second' });
  localStorage.setItem('mqtt-simulation-devices-a', JSON.stringify(saved));
  const publish = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(<SimulationPanel connectionId="a" isConnected onPublishMessage={publish} />),
  );
  await act(async () => (container.querySelector('.device-item') as HTMLElement).click());
  expect(container.querySelector('.signal-mode-pill')?.textContent).toBe('Combined');
  await click('Edit value');
  await act(async () => vi.advanceTimersByTimeAsync(1500));
  const payload = JSON.parse(container.querySelector('.preview-section pre')!.textContent!);
  expect(Object.keys(payload)).toEqual(['value', 'second']);
  expect(payload.value.value).toBeGreaterThan(0);
  await click('Cancel');
  await click('Publish Once');
  expect(JSON.parse(publish.mock.calls[0][0].payload).value.value).toBe(0);
  await click('Edit second');
  await click('Remove Signal');
  expect(container.textContent).toContain('Confirm removal');
  await click('Cancel');
  expect(container.querySelectorAll('.signal-overview-row')).toHaveLength(2);
  await click('Edit second');
  await click('Remove Signal');
  await click('Confirm removal');
  expect(container.querySelectorAll('.signal-overview-row')).toHaveLength(1);
  await click('Edit value');
  expect(container.querySelector('.remove-signal')).toBeNull();
});

it('does not persist live samples, stops on disconnect, and isolates connection changes', async () => {
  seed('a');
  seed('b');
  const publish = vi.fn().mockResolvedValue(undefined);
  const props = { connectionId: 'a', isConnected: true, onPublishMessage: publish };
  await act(async () =>
    root.render(
      <StrictMode>
        <SimulationPanel {...props} />
      </StrictMode>,
    ),
  );
  await act(async () => (container.querySelector('.device-item') as HTMLElement).click());
  await click('Start Loop');
  const saved = localStorage.getItem('mqtt-simulation-devices-a');
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(publish).toHaveBeenCalledTimes(3);
  expect(writes).not.toHaveBeenCalled();
  expect(saved).not.toContain('currentValue');
  await act(async () =>
    root.render(
      <StrictMode>
        <SimulationPanel {...props} isConnected={false} />
      </StrictMode>,
    ),
  );
  await act(async () =>
    root.render(
      <StrictMode>
        <SimulationPanel {...props} />
      </StrictMode>,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(publish).toHaveBeenCalledTimes(3);
  await act(async () =>
    root.render(
      <StrictMode>
        <SimulationPanel {...props} connectionId="b" />
      </StrictMode>,
    ),
  );
  expect(container.textContent).toContain('Device b');
  expect(JSON.parse(localStorage.getItem('mqtt-simulation-devices-a')!)[0].name).toBe('Device a');
});
