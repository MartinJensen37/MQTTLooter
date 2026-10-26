/*
 * Interoperability with a real Mosquitto broker. Runs a private instance on a free loopback
 * port with a temporary config, and is skipped when Mosquitto is not installed.
 * Set MOSQUITTO to the executable path if it is not in the default location or on PATH.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MQTTConnectionManager } from '../src/main/mqtt-connection-manager';

const candidates = [
  process.env.MOSQUITTO,
  process.platform === 'win32' ? 'C:\\Program Files\\mosquitto\\mosquitto.exe' : undefined,
  'mosquitto',
].filter(Boolean) as string[];
const binary = candidates.find((path) =>
  spawnSync(path, ['-h']).stdout?.toString().includes('mosquitto version'),
);
const sibling = (name: string) =>
  binary && binary.includes('mosquitto.exe') ? join(dirname(binary), `${name}.exe`) : name;

let directory: string;
let broker: ChildProcess;
let port: number;
const managers: MQTTConnectionManager[] = [];

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
const accepting = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = createConnection(port, '127.0.0.1', () => {
      socket.destroy();
      resolve(true);
    }).on('error', () => resolve(false));
  });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A connection through the app's own manager, collecting received messages. */
async function client(id: string, config: Record<string, unknown> = {}) {
  const manager = new MQTTConnectionManager();
  managers.push(manager);
  manager.on('error', () => {});
  const messages: any[] = [];
  manager.on('message', (message: any) => messages.push(message));
  const subscribed = new Promise((resolve) => manager.once('subscribed', resolve));
  const result = await manager.connect(id, {
    brokerUrl: `mqtt://127.0.0.1:${port}`,
    protocolVersion: 5,
    reconnectPeriod: 0,
    connectTimeout: 5000,
    clientId: id,
    username: 'looter',
    password: 'secret',
    ...config,
  });
  if ((config.subscriptions as unknown[] | undefined)?.length) await subscribed;
  return { manager, messages, result };
}
const until = async (check: () => boolean, label: string) => {
  for (let i = 0; i < 100 && !check(); i++) await sleep(50);
  expect(check(), label).toBe(true);
};

describe.skipIf(!binary)('Mosquitto interoperability', () => {
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'mqtt-mosquitto-'));
    port = await freePort();
    const passwords = join(directory, 'passwd');
    writeFileSync(passwords, '');
    spawnSync(sibling('mosquitto_passwd'), ['-b', passwords, 'looter', 'secret']);
    const config = join(directory, 'mosquitto.conf');
    writeFileSync(
      config,
      [
        `listener ${port} 127.0.0.1`,
        'allow_anonymous false',
        `password_file ${passwords.replace(/\\/g, '/')}`,
        'persistence false',
        'max_topic_alias 2',
      ].join('\n'),
    );
    broker = spawn(binary!, ['-c', config], { stdio: 'ignore' });
    for (let i = 0; i < 100 && !(await accepting(port)); i++) await sleep(50);
  }, 15_000);
  afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.disconnectAll()));
  });
  afterAll(() => {
    broker?.kill();
    rmSync(directory, { recursive: true, force: true });
  });

  it('rejects bad credentials for MQTT 3.1.1 and 5', async () => {
    for (const protocolVersion of [4, 5])
      await expect(
        client(`bad-${protocolVersion}`, { protocolVersion, password: 'wrong' }),
      ).rejects.toThrow(/not authori[sz]ed|bad user ?name or password/i);
  });

  it('connects, subscribes and publishes with the connection editor MQTT 5 defaults', async () => {
    const id = 'editor-defaults';
    const { manager, messages } = await client(id, {
      sessionExpiryInterval: 0,
      receiveMaximum: 65535,
      maximumPacketSize: 268435455,
      topicAliasMaximum: 0,
      requestResponseInformation: false,
      requestProblemInformation: true,
      userProperties: {},
      subscriptions: [{ topic: 'defaults/#', qos: 0, properties: { userProperties: {} } }],
    });
    await manager.publish(id, 'defaults/value', 'sent', { properties: { userProperties: {} } });
    await until(() => messages.some((message) => message.message === 'sent'), 'message received');
  });

  it('delivers queued QoS 1 messages to a persistent session, and drops them after expiry', async () => {
    const session = (id: string, sessionExpiryInterval: number) =>
      client(id, {
        clean: false,
        sessionExpiryInterval,
        subscriptions: [{ topic: 'persist/#', qos: 1 }],
      });
    const publisher = await client('publisher');
    const kept = await session('looter-kept', 60);
    const expiring = await session('looter-expiring', 1);
    await kept.manager.disconnect('looter-kept');
    await expiring.manager.disconnect('looter-expiring');
    await sleep(2000);
    await publisher.manager.publish('publisher', 'persist/offline', 'queued', { qos: 1 });

    const resumed = await session('looter-kept', 60);
    expect(resumed.result.connack.sessionPresent).toBe(true);
    await until(
      () => resumed.messages.some((message) => message.message === 'queued'),
      'queued message delivered after reconnect',
    );
    const expired = await session('looter-expiring', 1);
    expect(expired.result.connack.sessionPresent).toBe(false);
    await sleep(500);
    expect(expired.messages.some((message) => message.message === 'queued')).toBe(false);
  }, 15_000);

  it('publishes through negotiated topic aliases beyond the broker limit', async () => {
    const subscriber = await client('alias-subscriber', {
      subscriptions: [{ topic: 'alias/#', qos: 1 }],
    });
    const publisher = await client('alias-publisher', { autoAssignTopicAlias: true });
    expect(publisher.result.connack.properties.topicAliasMaximum).toBe(2);
    const topics = ['alias/a', 'alias/b', 'alias/c'];
    for (let round = 0; round < 3; round++)
      for (const topic of topics)
        await publisher.manager.publish('alias-publisher', topic, `${round}`, { qos: 1 });
    await until(() => subscriber.messages.length === 9, 'all aliased messages delivered');
    expect(subscriber.messages.map((message) => message.topic)).toEqual([
      ...topics,
      ...topics,
      ...topics,
    ]);
  });

  it('round-trips retained QoS 2 binary payloads with MQTT 5 properties', async () => {
    const publisher = await client('retain-publisher');
    await publisher.manager.publish('retain-publisher', 'retained/bytes', 'AP+A', {
      encoding: 'base64',
      qos: 2,
      retain: true,
      properties: {
        contentType: 'application/octet-stream',
        correlationData: { encoding: 'base64', data: 'AQI=' },
        userProperties: { site: ['lab', 'north'] },
      },
    });
    const subscriber = await client('retain-subscriber', {
      subscriptions: [{ topic: 'retained/#', qos: 2 }],
    });
    await until(() => subscriber.messages.length === 1, 'retained message');
    const [message] = subscriber.messages;
    expect(message).toMatchObject({
      topic: 'retained/bytes',
      message: 'AP+A',
      encoding: 'base64',
      qos: 2,
      retain: true,
    });
    expect(message.properties.contentType).toBe('application/octet-stream');
    expect(Buffer.from(message.properties.correlationData)).toEqual(Buffer.from([1, 2]));
    expect(message.properties.userProperties.site).toEqual(['lab', 'north']);
    // Clear the retained message for later runs.
    await publisher.manager.publish('retain-publisher', 'retained/bytes', '', { retain: true });
  });
});
