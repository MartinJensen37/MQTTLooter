// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MessageProperties from '../src/renderer/src/components/MessagePanel/MessageProperties';
import { correlationPreview, propertyRows } from '../src/renderer/src/utils/mqttProperties';
import { exportMessage, exportMessageCSV } from '../src/renderer/src/utils/messageExport';
import { serializeProperties } from '../src/shared/history';
import { payloadBytes } from '../src/shared/payload';

let root: Root;
let container: HTMLDivElement;
const writeText = vi.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function expand() {
  await act(async () =>
    container.querySelector<HTMLInputElement>('.message-properties input[type=checkbox]')!.click(),
  );
}

const properties = {
  payloadFormatIndicator: false,
  messageExpiryInterval: 0,
  responseTopic: 'response//topic',
  contentType: 'application/octet-stream',
  subscriptionIdentifier: [1, 3],
  topicAlias: 4,
  correlationData: Uint8Array.of(0, 255, 128, 13, 10),
  userProperties: { repeated: ['one', 'two'], empty: '', special: '<tag>"\nvalue' },
};

it('lazily inspects received properties, preserves repeats and copies exact binary data', async () => {
  const parentCopy = vi.fn();
  await act(async () =>
    root.render(
      <div onDoubleClick={parentCopy}>
        <MessageProperties protocolVersion={5} properties={properties} />
      </div>,
    ),
  );
  expect(container.textContent).toBe('MQTT 5 properties');
  await expand();
  expect(container.textContent).toContain('0 — Unspecified bytes');
  expect(container.textContent).toContain('Message expiry (seconds, as received)0');
  expect(container.textContent).toContain('00 ff 80 0d 0a');
  expect(
    [...container.querySelectorAll('dt')].filter((node) => node.textContent === 'User: repeated'),
  ).toHaveLength(2);
  expect(container.querySelector('tag')).toBeNull();
  await act(async () => {
    container.querySelector('pre')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    container.querySelector<HTMLButtonElement>('button')!.click();
  });
  expect(parentCopy).not.toHaveBeenCalled();
  expect(writeText).toHaveBeenLastCalledWith('AP+ADQo=');
  await act(async () => container.querySelectorAll<HTMLButtonElement>('button')[1].click());
  expect(JSON.parse(writeText.mock.calls.at(-1)![0])).toEqual(
    JSON.parse(serializeProperties(properties)!),
  );
  writeText.mockRejectedValueOnce(new Error('denied'));
  await act(async () => container.querySelectorAll<HTMLButtonElement>('button')[1].click());
  expect(container.querySelector('[role="status"]')!.textContent).toContain('Could not copy');
});

it('handles stored binary tags, empty correlation and bounded previews without truncating exports', () => {
  const bytes = Uint8Array.from({ length: 65535 }, (_, index) => index % 256);
  const stored = JSON.parse(serializeProperties({ correlationData: bytes })!);
  const preview = correlationPreview(stored.correlationData)!;
  expect(preview.hex.split(' ')).toHaveLength(256);
  expect(preview.length).toBe(bytes.length);
  expect(payloadBytes(preview.base64, 'base64')).toEqual(bytes);
  expect(correlationPreview({ encoding: 'base64', data: '' })).toEqual({
    base64: '',
    hex: '',
    length: 0,
  });
  expect(correlationPreview({ encoding: 'base64', data: 'bad' })).toBeUndefined();
  expect(correlationPreview(new Uint8Array(65536))).toBeUndefined();
  const large = {
    userProperties: { repeated: Array.from({ length: 100 }, () => 'x'.repeat(2000)) },
  };
  const result = propertyRows(large);
  expect(result.rows).toHaveLength(64);
  expect(result.rows[0].value.length).toBe(1025);
  expect(result.truncated).toBe(true);
  expect(
    propertyRows({ subscriptionIdentifier: Array.from({ length: 64 }, (_, i) => i + 1) }).truncated,
  ).toBe(false);
  const message = {
    id: '1',
    connectionId: 'broker',
    topic: 't',
    message: 'AP+A',
    encoding: 'base64' as const,
    timestamp: 1,
    qos: 0,
    retain: false,
    protocolVersion: 5,
    properties: { ...stored, ...large },
  };
  const exported = exportMessage(message);
  expect(exported.properties.userProperties.repeated).toHaveLength(100);
  expect(exported.properties.userProperties.repeated[0]).toHaveLength(2000);
  expect(payloadBytes(exported.payload, exported.encoding)).toEqual(Uint8Array.of(0, 255, 128));
  expect(exportMessageCSV([message])).toContain(
    JSON.stringify(exported.properties).replace(/"/g, '""'),
  );
});

it('omits MQTT 3 property controls and explicitly identifies empty MQTT 5 properties', async () => {
  await act(async () => root.render(<MessageProperties protocolVersion={4} />));
  expect(container.children).toHaveLength(0);
  await act(async () => root.render(<MessageProperties protocolVersion={5} />));
  await expand();
  expect(container.textContent).toContain('No publish properties were received.');
});

it('exports protocol and properties with unambiguous binary tags and CSV quoting', () => {
  const message = {
    id: '1',
    connectionId: 'broker"\nname',
    topic: 't',
    message: 'payload"\ntext',
    encoding: 'utf8' as const,
    timestamp: 1,
    qos: 0,
    retain: true,
    protocolVersion: 5,
    properties,
  };
  const exported = exportMessage(message);
  expect(exported.protocolVersion).toBe(5);
  expect(exported.properties.correlationData).toEqual({ encoding: 'base64', data: 'AP+ADQo=' });
  expect(exported.properties.userProperties.repeated).toEqual(['one', 'two']);
  const csv = exportMessageCSV([message]);
  expect(csv).toContain('"payload""\ntext"');
  expect(csv).toContain('"broker""\nname",5,');
  expect(csv).toContain('""correlationData"":{');
});
