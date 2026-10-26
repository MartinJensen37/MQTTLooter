import { expect, it } from 'vitest';
import {
  hostnameError,
  parseBrokerUrl,
  splitHostInput,
} from '../src/renderer/src/components/ConnectionSidebar/connectionModal/formHelpers';

it('takes the protocol, port and path from a pasted broker address', () => {
  expect(splitHostInput('mqtts://user:secret@broker.example:8884')).toEqual({
    hostname: 'broker.example',
    protocol: 'mqtts',
    port: 8884,
  });
  expect(splitHostInput('wss://test.mosquitto.org:8081/mqtt')).toEqual({
    hostname: 'test.mosquitto.org',
    protocol: 'wss',
    port: 8081,
    wsPath: '/mqtt',
  });
  expect(splitHostInput('tcp://[::1]:1883')).toMatchObject({ hostname: '[::1]', protocol: 'mqtt' });
});

it('keeps only the host of a web address and of plain text', () => {
  expect(splitHostInput('https://test.mosquitto.org/')).toEqual({ hostname: 'test.mosquitto.org' });
  expect(splitHostInput('  test.mosquitto.org ')).toEqual({ hostname: 'test.mosquitto.org' });
});

it('rejects hosts that still contain a URL or port', () => {
  expect(hostnameError('test.mosquitto.org')).toBe('');
  expect(hostnameError('[::1]')).toBe('');
  expect(hostnameError('')).toBe('Hostname is required');
  for (const host of ['https//test.mosquitto.org', 'broker:1883', 'my broker'])
    expect(hostnameError(host)).toContain('Enter only the host name');
});

it('recovers the host of an address saved with a URL in the host field', () => {
  expect(parseBrokerUrl('mqtt://https://test.mosquitto.org:1883')).toEqual({
    protocol: 'mqtt',
    hostname: 'test.mosquitto.org',
    port: 1883,
    pathname: '',
  });
  expect(parseBrokerUrl('ws://broker:9001/mqtt')).toMatchObject({
    hostname: 'broker',
    pathname: '/mqtt',
  });
});
