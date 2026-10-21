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
    client.emit('close');
    client.emit('reconnect');
    client.emit('connect', {});
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
});
