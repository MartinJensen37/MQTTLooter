// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PayloadView from '../src/renderer/src/components/MessagePanel/PayloadView';
import DecoderSettings from '../src/renderer/src/components/MessagePanel/DecoderSettings';
import { decoderRegistry } from '../src/renderer/src/services/DecoderRegistry';

const decoder = {
  id: 'reading',
  name: 'Reading',
  topicFilter: 'plant/+/reading',
  messageType: 'demo.Reading',
  proto: 'syntax = "proto3";',
};
let saved: any[];
const api = {
  list: vi.fn(async () => ({ success: true, data: { decoders: saved, errors: {} } })),
  save: vi.fn(async (decoders: any[]) => {
    if (decoders.some((item) => item.name === 'Broken'))
      return { success: false, error: 'Broken: no such type' };
    saved = decoders;
    return { success: true, data: decoders };
  }),
  types: vi.fn(async () => ({ success: true, data: ['demo.Reading', 'demo.Status'] })),
  decode: vi.fn(async (_id: string, message: string) =>
    message === 'bad'
      ? { success: false, error: 'Payload does not match demo.Reading' }
      : { success: true, data: '{\n  "value": 42\n}' },
  ),
};
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  saved = [decoder];
  Object.values(api).forEach((mock) => mock.mockClear());
  (window as any).electronAPI = { decoders: api };
  await decoderRegistry.refresh();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const select = async (label: string, value: string) =>
  act(async () => {
    const element = container.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });

it('shows decoded payloads by default for matching topics and keeps other views', async () => {
  await act(async () =>
    root.render(<PayloadView value="CCo=" encoding="base64" topic="plant/7/reading" />),
  );
  expect((container.querySelector('[aria-label="Payload view"]') as HTMLSelectElement).value).toBe(
    'decoded',
  );
  expect(container.querySelector('.payload-preview')!.textContent).toContain('"value": 42');
  expect(api.decode).toHaveBeenCalledWith('reading', 'CCo=', 'base64');
  await select('Payload view', 'hex');
  expect(container.querySelector('.payload-preview')!.textContent).toBe('08 2a');
  // Cached: switching back does not decode again.
  await select('Payload view', 'decoded');
  expect(api.decode).toHaveBeenCalledTimes(1);

  await act(async () => root.render(<PayloadView value="bad" topic="plant/7/reading" />));
  expect(container.textContent).toContain('Payload does not match demo.Reading');
  await act(async () => root.render(<PayloadView value="plain" topic="other/topic" />));
  expect(container.querySelector('option[value="decoded"]')).toBeNull();
  expect(container.querySelector('.payload-preview')!.textContent).toBe('plain');
});

it('adds decoders from a .proto file, reports compile errors and removes decoders', async () => {
  saved = [];
  await decoderRegistry.refresh();
  await act(async () => root.render(<DecoderSettings onClose={() => {}} />));
  const add = () =>
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Add decoder',
    )!;
  // jsdom's File has no text(); the dialog only needs these members. The input remounts
  // after each successful add, so attach the file to the current one.
  const chooseFile = () =>
    act(async () => {
      const input = container.querySelector(
        '[aria-label="Protobuf schema file"]',
      ) as HTMLInputElement;
      Object.defineProperty(input, 'files', {
        value: [{ name: 'demo.proto', size: 18, text: async () => 'syntax = "proto3";' }],
        configurable: true,
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  expect(add().disabled).toBe(true);
  await chooseFile();
  expect((container.querySelector('[aria-label="Decoder name"]') as HTMLInputElement).value).toBe(
    'Reading',
  );
  await select('Message type', 'demo.Status');
  await act(async () => add().click());
  expect(saved).toMatchObject([{ name: 'Reading', messageType: 'demo.Status', topicFilter: '#' }]);
  expect(container.querySelector('[aria-label="Saved decoders"]')!.textContent).toContain(
    'demo.Status',
  );
  expect(add().disabled).toBe(true);

  await chooseFile();
  await act(async () => {
    const input = container.querySelector('[aria-label="Decoder name"]') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Broken',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => add().click());
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('no such type');
  expect(saved).toHaveLength(1);

  await act(async () =>
    (container.querySelector('[aria-label="Remove decoder Reading"]') as HTMLButtonElement).click(),
  );
  expect(saved).toEqual([]);
});
