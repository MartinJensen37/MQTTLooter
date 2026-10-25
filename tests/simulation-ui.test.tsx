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

it('configures, previews, saves and publishes timed transition signals', async () => {
  seed('transitions');
  const publish = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <SimulationPanel connectionId="transitions" isConnected onPublishMessage={publish} />,
    ),
  );
  await act(async () => (container.querySelector('.device-item') as HTMLElement).click());
  await click('Edit value');
  await input('Generator', 'ramp');
  await input('Ramp duration', '0');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('durationMs');
  expect(container.querySelector('.signal-waveform')).toBeNull();
  await input('Ramp duration', '2000');
  expect(container.querySelector('.signal-waveform svg')?.getAttribute('aria-label')).toContain(
    'ramp waveform',
  );
  await input('Generator', 'response');
  await input('Time constant', '500');
  expect(container.querySelector('.signal-waveform svg')?.getAttribute('aria-label')).toContain(
    'response waveform',
  );
  await click('Save Signal');
  await click('Edit value');
  expect((container.querySelector('.signal-dialog select') as HTMLSelectElement).value).toBe(
    'number',
  );
  expect(container.querySelector('.signal-waveform svg')?.getAttribute('aria-label')).toContain(
    'response waveform',
  );
  await input('Generator', 'step');
  await input('Starting value', '10');
  await input('Final value', '-20');
  await input('Transition delay', '0');
  expect(container.querySelector('.preview-section pre')?.textContent).toContain('-20');
  await click('Save Signal');
  await click('Publish Once');
  expect(JSON.parse(publish.mock.calls[0][0].payload).value).toBe(-20);
  const saved = JSON.parse(localStorage.getItem('mqtt-simulation-devices-transitions')!);
  expect(saved[0].outputs[0]).toMatchObject({
    generator: 'step',
    config: { start: 10, end: -20, delayMs: 0 },
  });
});

it('publishes raw strings, previews exact bytes and reopens non-JSON last publications', async () => {
  seed('a');
  const saved = JSON.parse(localStorage.getItem('mqtt-simulation-devices-a')!);
  saved[0].outputs[0] = {
    ...saved[0].outputs[0],
    dataType: 'string',
    config: { value: '  café 🌡️\r\n' },
  };
  localStorage.setItem('mqtt-simulation-devices-a', JSON.stringify(saved));
  const publish = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(<SimulationPanel connectionId="a" isConnected onPublishMessage={publish} />),
  );
  await act(async () => (container.querySelector('.device-item') as HTMLElement).click());
  await input('Payload format', 'raw');
  await click('Edit value');
  expect(container.querySelector('.preview-section pre')!.textContent).toBe('  café 🌡️\r\n');
  await input('Preview view', 'hex');
  expect(container.querySelector('.preview-section pre')!.textContent).toBe(
    '20 20 63 61 66 c3 a9 20 f0 9f 8c a1 ef b8 8f 0d 0a',
  );
  await click('Cancel');
  await click('Publish Once');
  expect(publish.mock.calls[0][0].payload).toBe('  café 🌡️\r\n');
  await click('Edit value');
  expect(container.querySelector('.last-published pre')!.textContent).toBe('  café 🌡️\r\n');
  expect(container.querySelector('.last-published')!.textContent).toContain('17 UTF-8 bytes');
  await click('Cancel');
  await input('Payload format', 'json');
  await click('Edit value');
  expect(JSON.parse(container.querySelector('.preview-section pre')!.textContent!).value).toBe(
    '  café 🌡️\r\n',
  );
  expect(container.querySelector('.last-published pre')!.textContent).toBe('  café 🌡️\r\n');
  const persisted = JSON.parse(localStorage.getItem('mqtt-simulation-devices-a')!)[0];
  expect(persisted).toMatchObject({ schemaVersion: 1, payloadMode: 'json', isPublishing: false });
});

it('keeps unsupported future device settings untouched', async () => {
  seed('future');
  const saved = JSON.parse(localStorage.getItem('mqtt-simulation-devices-future')!);
  saved[0].schemaVersion = 2;
  const original = JSON.stringify(saved);
  localStorage.setItem('mqtt-simulation-devices-future', original);
  await act(async () =>
    root.render(<SimulationPanel connectionId="future" isConnected onPublishMessage={vi.fn()} />),
  );
  expect(container.textContent).toContain('Unsupported saved device schema version');
  expect(localStorage.getItem('mqtt-simulation-devices-future')).toBe(original);
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

it('builds combined payloads from a template and blocks publishing an invalid one', async () => {
  seed('a');
  const publish = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(<SimulationPanel connectionId="a" isConnected onPublishMessage={publish} />),
  );
  await act(async () => (container.querySelector('.device-item') as HTMLElement).click());
  await input('Payload structure', 'template');
  const area = () =>
    container.querySelector('[aria-label="Payload template"]') as HTMLTextAreaElement;
  // The starting template names every signal.
  expect(JSON.parse(area().value)).toEqual({
    device: 'Device a',
    timestamp: '{{isoTimestamp}}',
    values: { value: '{{value}}' },
  });
  await click('Publish Once');
  const sent = JSON.parse(publish.mock.calls[0][0].payload);
  expect(sent).toMatchObject({ device: 'Device a', values: { value: 0 } });
  expect(new Date(sent.timestamp).toISOString()).toBe(sent.timestamp);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      area(),
      '{"v": "{{nope}}"}',
    );
    area().dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelector('.device-config [role="alert"]')!.textContent).toContain(
    'Unknown template expression: nope',
  );
  const once = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Publish Once',
  )!;
  expect(once.disabled).toBe(true);
  expect(JSON.parse(localStorage.getItem('mqtt-simulation-devices-a')!)[0]).toMatchObject({
    payloadFormat: 'template',
    payloadTemplate: '{"v": "{{nope}}"}',
  });
});

it('builds a device template from a JSON Schema, using signals for matching properties', async () => {
  seed('a');
  const publish = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(<SimulationPanel connectionId="a" isConnected onPublishMessage={publish} />),
  );
  await act(async () => (container.querySelector('.device-item') as HTMLElement).click());
  await input('Payload structure', 'template');
  const choose = (text: string) =>
    act(async () => {
      const element = container.querySelector(
        '[aria-label="Build payload template from JSON Schema"]',
      ) as HTMLInputElement;
      // jsdom's File has no text(); the editor only needs these members.
      Object.defineProperty(element, 'files', {
        value: [{ size: text.length, text: async () => text }],
        configurable: true,
      });
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  await choose('{ not json');
  expect(container.querySelector('.device-config [role="alert"]')!.textContent).toContain(
    'Schema could not be used',
  );
  await choose(
    JSON.stringify({
      type: 'object',
      required: ['site', 'value', 'id'],
      properties: {
        site: { const: 'plant-7' },
        value: { type: 'number' },
        id: { type: 'string', format: 'uuid' },
      },
    }),
  );
  const template = JSON.parse(
    (container.querySelector('[aria-label="Payload template"]') as HTMLTextAreaElement).value,
  );
  expect(template).toEqual({ site: 'plant-7', value: '{{value}}', id: '{{uuid}}' });
  await click('Publish Once');
  const sent = JSON.parse(publish.mock.calls[0][0].payload);
  expect(sent).toMatchObject({ site: 'plant-7', value: 0 });
  expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
});
