// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PublishingPanel from '../src/renderer/src/components/PublishingPanel/PublishingPanel';
import { emptyPropertyDraft } from '../src/renderer/src/components/PublishingPanel/publishingPanel/propertyDraft';

vi.mock('../src/renderer/src/services/TopicTreeService', () => ({
  default: {
    getTopicMessages: () => [
      {
        message: 'incoming',
        encoding: 'utf8',
        qos: 0,
        retain: true,
        properties: { topicAlias: 1 },
      },
    ],
  },
}));
let root: Root;
let container: HTMLDivElement;
const publish = vi.fn();
const selectedTopic = {
  topicPath: 'selected',
  node: { lastMessageId: 1, lastMessage: { retain: true } },
};
const render = async (protocolVersion = 5) =>
  act(async () =>
    root.render(
      <PublishingPanel
        connectionId="properties"
        protocolVersion={protocolVersion}
        isConnected
        selectedTopic={selectedTopic}
        onPublishMessage={publish}
      />,
    ),
  );
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
async function field(label: string, value: string) {
  await act(async () => {
    const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[aria-label="${label}"]`,
    )!;
    const type = element instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(type.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
async function check(text: string) {
  await act(async () =>
    [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.trim() === text)!
      .querySelector('input')!
      .click(),
  );
}
async function click(selector: string) {
  await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click());
}

it('publishes exact properties, preserves distinct history and restores saved drafts', async () => {
  await render();
  await check('Include MQTT 5 properties');
  await field('Publish response topic', 'reply//sensor');
  await field('Publish expiry', '0');
  await field('Publish payload format', 'bytes');
  await check('Include correlation data');
  await field('Publish correlation data', '00 ff 80');
  await click('.publish-form-publish-btn');
  expect(publish.mock.calls[0][0].properties).toMatchObject({
    responseTopic: 'reply//sensor',
    messageExpiryInterval: 0,
    payloadFormatIndicator: false,
    correlationData: { encoding: 'base64', data: 'AP+A' },
  });
  await field('Publish correlation data', '01');
  await click('.publish-form-publish-btn');
  expect(container.querySelectorAll('.history-item')).toHaveLength(2);
  await click('.publish-form-clear-btn');
  await click('.history-item:nth-child(2) .load-btn');
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="Publish correlation data"]')!.value,
  ).toBe('AP+A');
  expect(container.querySelector<HTMLInputElement>('[aria-label="Publish expiry"]')!.value).toBe(
    '0',
  );
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="Publish correlation data"]')!.value,
  ).toBe('AP+A');
  await click('.publish-form-publish-btn');
  expect(publish.mock.calls.at(-1)![0].properties.correlationData.data).toBe('AP+A');
});

it('blocks invalid bytes and MQTT 3 use, while retained deletion and selected-payload loading stay scoped', async () => {
  await render();
  await check('Include MQTT 5 properties');
  await check('Include correlation data');
  await field('Publish correlation data', 'bad');
  expect(container.querySelector<HTMLButtonElement>('.publish-form-publish-btn')!.disabled).toBe(
    true,
  );
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('complete bytes');
  await click('.publish-form-remove-retained-btn');
  expect(publish.mock.calls[0][0]).toMatchObject({ topic: 'selected', payload: '', retain: true });
  expect(publish.mock.calls[0][0]).not.toHaveProperty('properties');
  await field('Publish correlation data', '00');
  await render(4);
  expect(container.querySelector<HTMLButtonElement>('.publish-form-publish-btn')!.disabled).toBe(
    true,
  );
  expect(container.querySelector('[role="alert"]')!.textContent).toContain('MQTT 5');
  await check('Include MQTT 5 properties');
  await click('.publish-form-publish-btn');
  expect(publish.mock.calls.at(-1)![0].properties).toBeUndefined();
  await render();
  await check('Include MQTT 5 properties');
  await click('.publish-form-load-topic-btn');
  await click('.publish-form-publish-btn');
  expect(publish.mock.calls.at(-1)![0]).toMatchObject({ payload: 'incoming' });
  expect(publish.mock.calls.at(-1)![0].properties).toBeUndefined();
});

it('bounds oversized saved property lists and lets the user clear them before publishing', async () => {
  localStorage.setItem(
    'publish-form-state-properties',
    JSON.stringify({
      propertyDraft: {
        ...emptyPropertyDraft(),
        enabled: true,
        users: Array.from({ length: 1000 }, () => ({ name: 'key', value: 'value' })),
      },
    }),
  );
  await render();
  expect(container.querySelectorAll('.publish-user-property')).toHaveLength(64);
  expect(container.querySelector<HTMLButtonElement>('.publish-form-publish-btn')!.disabled).toBe(
    true,
  );
  expect(container.textContent).toContain('oversized draft');
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Clear user properties')!
      .click(),
  );
  expect(container.querySelectorAll('.publish-user-property')).toHaveLength(0);
  expect(container.querySelector<HTMLButtonElement>('.publish-form-publish-btn')!.disabled).toBe(
    false,
  );
});
