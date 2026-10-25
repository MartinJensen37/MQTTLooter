import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mqtt from 'mqtt';
import { MQTTConnectionManager } from '../src/main/mqtt-connection-manager';

vi.mock('mqtt', () => ({ default: { connect: vi.fn() } }));

class Client extends EventEmitter {
  options: any = {};
  end = vi.fn((_force?: boolean, options?: any, callback?: () => void) => {
    if (typeof options === 'function') options();
    callback?.();
  });
  subscribe = vi.fn((topic, options, callback) => callback(null, [{ topic, qos: options.qos }]));
  publish = vi.fn((_topic, _message, _options, callback) => callback(null));
}

describe('MQTT lifecycle', () => {
  let manager: MQTTConnectionManager;
  let client: Client;
  beforeEach(() => {
    vi.useFakeTimers();
    client = new Client();
    vi.mocked(mqtt.connect).mockImplementation((_url: any, options: any) => {
      client.options = options;
      return client as any;
    });
    manager = new MQTTConnectionManager();
    manager.on('error', () => {});
  });
  afterEach(async () => {
    await manager.disconnectAll();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('validates outgoing MQTT 5 properties and converts correlation bytes for the packet codec', async () => {
    const connecting = manager.connect('a', { brokerUrl: 'mqtt://localhost', protocolVersion: 5 });
    client.emit('connect', {});
    await connecting;
    await manager.publish('a', 'request/topic', '', {
      qos: 1,
      properties: {
        responseTopic: 'response/topic',
        correlationData: { encoding: 'base64', data: 'AP+A' },
        messageExpiryInterval: 0,
        payloadFormatIndicator: false,
        userProperties: { repeated: ['a', 'b'] },
      },
    });
    expect(client.publish.mock.calls[0][2]).toMatchObject({
      properties: {
        correlationData: Buffer.from([0, 255, 128]),
        messageExpiryInterval: 0,
        payloadFormatIndicator: false,
        userProperties: { repeated: ['a', 'b'] },
      },
    });
    for (const properties of [
      { topicAlias: 1 },
      { subscriptionIdentifier: 1 },
      { responseTopic: 'a/#' },
      { correlationData: { encoding: 'base64', data: 'bad' } },
    ])
      await expect(manager.publish('a', 'request/topic', '', { properties })).rejects.toThrow();
    await expect(manager.publish('a', 'a/+', '')).rejects.toThrow('wildcards');
    await expect(manager.publish('a', 'a', '', { qos: 3 })).rejects.toThrow('QoS');
    await expect(
      manager.publish('a', 'a', '/w==', {
        encoding: 'base64',
        properties: { payloadFormatIndicator: true },
      }),
    ).rejects.toThrow('UTF-8');
    expect(client.publish).toHaveBeenCalledTimes(1);
  });

  it('rejects MQTT 5 properties on MQTT 3 connections before publishing', async () => {
    const connecting = manager.connect('a', { brokerUrl: 'mqtt://localhost', protocolVersion: 4 });
    client.emit('connect', {});
    await connecting;
    await expect(
      manager.publish('a', 'topic', '', { properties: { contentType: 'text/plain' } }),
    ).rejects.toThrow('MQTT 5');
    expect(client.publish).not.toHaveBeenCalled();
    await manager.publish('a', 'topic', '', {});
    expect(client.publish.mock.calls[0][2]).not.toHaveProperty('properties');
  });

  it('settles on an early close and removes the failed client', async () => {
    const result = manager.connect('a', { brokerUrl: 'mqtt://localhost' });
    const rejected = expect(result).rejects.toThrow('before CONNACK');
    client.emit('close');
    await rejected;
    expect(manager.getConnection('a')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an in-flight connect and clears its timeout', async () => {
    const result = manager.connect('a', { brokerUrl: 'mqtt://localhost' });
    const rejected = expect(result).rejects.toThrow('cancelled');
    await manager.disconnect('a');
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares concurrent connects and uses MQTT 5 clean and zero-valued settings', async () => {
    const config = {
      brokerUrl: 'wss://localhost/?token=test',
      wsPath: '/mqtt',
      protocolVersion: 5,
      clean: false,
      keepalive: 0,
      reconnectPeriod: 0,
      willEnabled: true,
      willTopic: 'will',
      willMessage: '',
      userProperties: { app: 'test' },
    };
    const first = manager.connect('a', config);
    const second = manager.connect('a', config);
    expect(mqtt.connect).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mqtt.connect).mock.calls[0][0]).toBe('wss://localhost/mqtt?token=test');
    expect(client.options).toMatchObject({
      clean: false,
      keepalive: 0,
      will: { payload: '' },
      properties: { userProperties: { app: 'test' } },
    });
    client.emit('connect', { properties: { receiveMaximum: 10 } });
    await Promise.all([first, second]);
    expect(client.options.reconnectPeriod).toBe(0);
  });

  it('reconnects with configured subscriptions without duplicating handlers', async () => {
    const result = manager.connect('a', {
      brokerUrl: 'mqtt://localhost',
      reconnectPeriod: 500,
      subscriptions: [{ topic: '#', qos: 1 }],
    });
    client.emit('connect', {});
    await result;
    expect(client.options.reconnectPeriod).toBe(500);
    const received = vi.fn();
    manager.on('message', received);
    client.emit('message', 'value', Buffer.from('1'), { qos: 0 });
    client.emit('message', 'value', Buffer.from('2'), { qos: 0 });
    client.emit('close');
    client.emit('reconnect');
    client.emit('connect', {});
    client.emit('message', 'value', Buffer.from('3'), { qos: 0 });
    expect(received.mock.calls.map(([message]) => message.sequence)).toEqual([1, 2, 1]);
    expect(received.mock.calls[0][0].sessionId).not.toBe(received.mock.calls[2][0].sessionId);
    expect(client.subscribe).toHaveBeenCalledTimes(2);
    expect(client.listenerCount('message')).toBe(1);
  });

  it('rejects denied SUBACKs', async () => {
    const result = manager.connect('a', { brokerUrl: 'mqtt://localhost' });
    client.emit('connect', {});
    await result;
    client.subscribe.mockImplementation((topic, _options, callback) =>
      callback(null, [{ topic, qos: 128 }]),
    );
    await expect(manager.subscribe('a', 'denied')).rejects.toThrow('rejected');
    expect(manager.getConnection('a')?.subscriptions.size).toBe(0);
  });

  it('receives and republishes binary bytes without UTF-8 replacement', async () => {
    const result = manager.connect('a', { brokerUrl: 'mqtt://localhost' });
    client.emit('connect', {});
    await result;
    const received = vi.fn();
    manager.on('message', received);
    const bytes = Buffer.from([0, 255, 128, 10]);
    client.emit('message', 'binary', bytes, { qos: 0, retain: true });
    const message = received.mock.calls[0][0];
    expect(message).toMatchObject({ encoding: 'base64', byteLength: 4 });
    await manager.publish('a', 'binary', message.message, {
      encoding: message.encoding,
      qos: 0,
      retain: true,
    });
    expect(client.publish.mock.calls[0].slice(0, 3)).toEqual([
      'binary',
      bytes,
      { qos: 0, retain: true, dup: false },
    ]);
    await expect(manager.publish('a', 'binary', 'bad', { encoding: 'base64' })).rejects.toThrow();
    expect(client.publish).toHaveBeenCalledTimes(1);
  });

  it('enables negotiated outgoing topic aliases only for MQTT 5 connections that opt in', async () => {
    for (const [protocolVersion, autoAssignTopicAlias, expected] of [
      [5, true, true],
      [5, false, undefined],
      [4, true, undefined],
    ] as const) {
      const result = manager.connect('a', {
        brokerUrl: 'mqtt://localhost',
        protocolVersion,
        autoAssignTopicAlias,
      });
      client.emit('connect', {});
      await result;
      expect(client.options.autoAssignTopicAlias).toBe(expected);
      await manager.disconnect('a');
    }
  });

  it('keeps credentials out of connection status', async () => {
    const result = manager.connect('a', {
      brokerUrl: 'mqtt://localhost',
      password: 'secret-password',
      tls: { enabled: true, key: { content: 'secret-key' }, passphrase: 'secret-phrase' },
    });
    client.emit('connect', {});
    await result;
    const status = JSON.stringify(manager.getAllConnections());
    expect(status).toContain('"isConnected":true');
    expect(status).not.toMatch(/secret/);
  });
});
