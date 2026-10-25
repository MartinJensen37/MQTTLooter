// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PublishingPanel from '../src/renderer/src/components/PublishingPanel/PublishingPanel';

let root: Root;
let container: HTMLDivElement;
const publish = vi.fn();
beforeEach(() => {
  localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  publish.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <PublishingPanel
        connectionId="templates"
        isConnected
        protocolVersion={5}
        onPublishMessage={publish}
      />,
    ),
  );
}
async function click(selector: string) {
  await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click());
}
async function field(selector: string, value: string) {
  await act(async () => {
    const element = container.querySelector<HTMLInputElement>(selector)!;
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
async function select(index = 1) {
  if (!container.querySelector('.template-select-wrapper'))
    await click('.template-checkbox-label input');
  await click('.template-select-wrapper > button');
  await click(`.template-dropdown-item:nth-of-type(${index}) .dropdown-option`);
}
const payload = () => container.querySelector<HTMLTextAreaElement>('#payload')!.value;
const topic = () => container.querySelector<HTMLInputElement>('#topic')!.value;

it('applies defaults, edits variables explicitly and publishes exactly the visible typed draft', async () => {
  await render();
  await select();
  expect(topic()).toBe('sensors/temperature/temp-001');
  expect(JSON.parse(payload()).sensorId).toBe('temp-001');
  expect(container.querySelector('.schema-validation')!.textContent).toBe('Schema Valid');
  const before = payload();
  await field('[aria-label="Template variable sensorId"]', 'room"1');
  expect(payload()).toBe(before);
  await click('.publish-template-variables button');
  expect(topic()).toBe('sensors/temperature/room"1');
  expect(JSON.parse(payload()).sensorId).toBe('room"1');
  expect(typeof JSON.parse(payload()).temperature).toBe('number');
  const draft = payload();
  await click('.publish-form-publish-btn');
  expect(publish.mock.calls[0][0]).toMatchObject({ topic: topic(), payload: draft });
  await field('#topic', 'manual/topic');
  await field('[aria-label="Template variable sensorId"]', 'two');
  await click('.publish-template-variables button');
  expect(topic()).toBe('manual/topic');
  expect(JSON.parse(payload()).sensorId).toBe('two');
});

it('keeps the draft unchanged on failure and allows correcting typed variables', async () => {
  localStorage.setItem(
    'mqtt-message-templates',
    JSON.stringify({
      typed: {
        id: 'typed',
        name: 'Typed',
        topic: 'typed',
        payload: '{"n":"{{n}}","flag":"{{flag}}","meta":"{{meta}}"}',
        variables: {
          n: { type: 'integer', default: 1 },
          flag: { type: 'boolean', default: false },
          meta: { type: 'json', default: { ok: true } },
        },
        properties: { correlationData: { encoding: 'base64', data: 'AP8=' } },
      },
    }),
  );
  await render();
  await select();
  const before = payload();
  await field('[aria-label="Template variable n"]', 'bad');
  await click('.publish-template-variables button');
  expect(payload()).toBe(before);
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('safe integer');
  expect(container.querySelector<HTMLButtonElement>('.publish-form-publish-btn')!.disabled).toBe(
    true,
  );
  await field('[aria-label="Template variable n"]', '-2');
  await field('[aria-label="Template variable flag"]', 'true');
  await field('[aria-label="Template variable meta"]', '[1,null]');
  await click('.publish-template-variables button');
  expect(JSON.parse(payload())).toEqual({ n: -2, flag: true, meta: [1, null] });
  await click('.publish-form-publish-btn');
  expect(publish.mock.calls[0][0].properties.correlationData.data).toBe('AP8=');
  await click('.publish-form-clear-btn');
  expect(container.querySelector('.publish-template-variables')).toBeNull();
});

it('reports malformed saved templates without losing the existing draft', async () => {
  localStorage.setItem(
    'mqtt-message-templates',
    JSON.stringify({
      bad: {
        id: 'bad',
        name: 'Bad',
        topic: '{{missing}}',
        payload: '{}',
        variables: { missing: null },
      },
    }),
  );
  await render();
  await field('#topic', 'existing');
  await field('#payload', 'unchanged');
  await select();
  expect(container.querySelector('[role="alert"]')!.textContent).toContain(
    'Invalid variable definition',
  );
  expect(topic()).toBe('existing');
  expect(payload()).toBe('unchanged');
  await click('.template-checkbox-label input');
  expect(container.querySelector<HTMLButtonElement>('.publish-form-publish-btn')!.disabled).toBe(
    false,
  );
});
