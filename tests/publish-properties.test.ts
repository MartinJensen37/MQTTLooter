import { expect, it } from 'vitest';
import { normalizePublishProperties, validatePublishTopic } from '../src/shared/publish-properties';
import {
  buildPublishProperties,
  draftFromProperties,
  emptyPropertyDraft,
} from '../src/renderer/src/components/PublishingPanel/publishingPanel/propertyDraft';

it('preserves absent, empty, false, zero and repeated properties through drafts', () => {
  const draft = {
    ...emptyPropertyDraft(),
    enabled: true,
    expiry: '0',
    format: 'bytes' as const,
    correlationEnabled: true,
    correlation: '00 ff 80',
    responseTopic: '/response//',
    users: [
      { name: 'key', value: 'first' },
      { name: 'key', value: '' },
      { name: '__proto__', value: 'safe' },
    ],
  };
  const properties = buildPublishProperties(draft, 5, new Uint8Array())!;
  expect(properties).toMatchObject({
    messageExpiryInterval: 0,
    payloadFormatIndicator: false,
    correlationData: { encoding: 'base64', data: 'AP+A' },
    userProperties: { key: ['first', ''] },
  });
  expect(Object.hasOwn(properties.userProperties!, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(properties.userProperties)).toBe(Object.prototype);
  expect(buildPublishProperties(draftFromProperties(properties), 5, new Uint8Array())).toEqual(
    properties,
  );
  expect(buildPublishProperties({ ...draft, enabled: false }, 4, new Uint8Array())).toBeUndefined();
  expect(() => buildPublishProperties(draft, 4, new Uint8Array())).toThrow('MQTT 5');
  expect(
    buildPublishProperties({ ...draft, correlation: '' }, 5, new Uint8Array())!.correlationData,
  ).toEqual({ encoding: 'base64', data: '' });
  expect(normalizePublishProperties({}, 4)).toBeUndefined();
  // MQTT.js never sends a packet with an empty user property map.
  expect(normalizePublishProperties({ userProperties: {} }, 5)).not.toHaveProperty(
    'userProperties',
  );
});

it('rejects malformed properties, unsupported aliases and forbidden outbound subscription identifiers', () => {
  for (const properties of [
    null,
    [],
    'bad',
    { responseTopic: '' },
    { responseTopic: 'a/+' },
    { responseTopic: 'a/#' },
    { responseTopic: 'a\0b' },
    { contentType: '\uD800' },
    { contentType: 'é'.repeat(32768) },
    { messageExpiryInterval: -1 },
    { messageExpiryInterval: 1.5 },
    { messageExpiryInterval: 4294967296 },
    { messageExpiryInterval: '1' },
    { payloadFormatIndicator: 1 },
    { correlationData: 'text' },
    { correlationData: { encoding: 'base64', data: 'Zh==' } },
    { userProperties: { name: [1] } },
    { userProperties: { name: [] } },
    { topicAlias: 1 },
    { subscriptionIdentifier: 1 },
  ])
    expect(() => normalizePublishProperties(properties, 5)).toThrow();
  expect(() => normalizePublishProperties({ contentType: 'text/plain' }, 4)).toThrow('MQTT 5');
  for (const correlation of ['0', 'gg', '00 1'])
    expect(() =>
      buildPublishProperties(
        { ...emptyPropertyDraft(), enabled: true, correlationEnabled: true, correlation },
        5,
        new Uint8Array(),
      ),
    ).toThrow('hex');
  for (const expiry of ['1.5', '-1', '1e3', ' '])
    expect(() =>
      buildPublishProperties(
        { ...emptyPropertyDraft(), enabled: true, expiry },
        5,
        new Uint8Array(),
      ),
    ).toThrow('Expiry');
  for (const topic of ['', 'a/+', 'a\0b', '\uD800', 'é'.repeat(32768)])
    expect(() => validatePublishTopic(topic)).toThrow();
  expect(() => validatePublishTopic('/a//b')).not.toThrow();
});

it('bounds total property bytes and pair counts, and validates declared UTF-8 against actual payload bytes', () => {
  expect(() =>
    normalizePublishProperties({ userProperties: { key: Array(65).fill('') } }, 5),
  ).toThrow('64 user');
  expect(() => normalizePublishProperties({ contentType: 'x'.repeat(65535) }, 5)).toThrow('64 KiB');
  expect(() => normalizePublishProperties({ correlationData: new Uint8Array(65536) }, 5)).toThrow(
    '65,535',
  );
  expect(() =>
    normalizePublishProperties({ payloadFormatIndicator: true }, 5, Uint8Array.of(255)),
  ).toThrow('invalid UTF-8');
  expect(
    normalizePublishProperties({ payloadFormatIndicator: false }, 5, Uint8Array.of(255)),
  ).toEqual({ payloadFormatIndicator: false });
  expect(
    normalizePublishProperties(
      { payloadFormatIndicator: true, messageExpiryInterval: 4294967295 },
      5,
      new TextEncoder().encode('🌡️'),
    ),
  ).toEqual({ payloadFormatIndicator: true, messageExpiryInterval: 4294967295 });
});
