import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createRequire } from 'node:module';
import type { AddressInfo, Server } from 'node:net';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { createServer as createTlsServer } from 'node:tls';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createWebSocketStream, WebSocketServer } from 'ws';
import { MQTTConnectionManager, type BrokerConfig } from '../src/main/mqtt-connection-manager';

// The packet codec belonging to the installed MQTT client.
const local = createRequire(import.meta.url);
const codec = createRequire(local.resolve('mqtt'))('mqtt-packet');
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'tls', name), 'utf8');
const ca = fixture('ca.crt');
const server = { key: fixture('server.key'), cert: fixture('server.crt') };
const client = { cert: fixture('client.crt'), key: fixture('client.key') };
const file = (content: string) => ({
  name: 'test',
  content,
  size: content.length,
  lastModified: 0,
});
const PASSWORD = 'broker-password';

const received: any[] = [];
/** A minimal broker on any duplex stream: password check, QoS 1/2 acknowledgements, ping. */
function serve(stream: Duplex) {
  const parser = codec.parser();
  let protocolVersion = 4;
  const send = (packet: object) => {
    if (!stream.destroyed) stream.write(codec.generate(packet, { protocolVersion }));
  };
  parser.on('packet', (packet: any) => {
    if (packet.cmd === 'connect') {
      protocolVersion = packet.protocolVersion;
      const denied = packet.password !== undefined && packet.password.toString() !== PASSWORD;
      send({
        cmd: 'connack',
        sessionPresent: false,
        // 4 (MQTT 3.1.1) and 0x86 (MQTT 5) both mean bad user name or password.
        returnCode: denied ? 4 : 0,
        reasonCode: denied ? 0x86 : 0,
      });
      if (denied) stream.end();
    } else if (packet.cmd === 'subscribe') {
      send({
        cmd: 'suback',
        messageId: packet.messageId,
        granted: packet.subscriptions.map((item: any) => item.qos),
      });
    } else if (packet.cmd === 'publish') {
      received.push(packet);
      if (packet.qos === 1) send({ cmd: 'puback', messageId: packet.messageId });
      if (packet.qos === 2) send({ cmd: 'pubrec', messageId: packet.messageId });
    } else if (packet.cmd === 'pubrel') send({ cmd: 'pubcomp', messageId: packet.messageId });
    else if (packet.cmd === 'pingreq') send({ cmd: 'pingresp' });
  });
  parser.on('error', () => stream.destroy());
  stream.on('data', (data) => parser.parse(data));
  stream.on('error', () => {});
}

const servers: (Server | HttpServer)[] = [];
const ports: Record<string, number> = {};
const listen = async (name: string, instance: Server | HttpServer) => {
  servers.push(instance);
  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve));
  ports[name] = (instance.address() as AddressInfo).port;
};
const websocket = (instance: HttpServer) =>
  new WebSocketServer({ server: instance, path: '/mqtt' }).on('connection', (socket) =>
    serve(createWebSocketStream(socket)),
  );

beforeAll(async () => {
  await listen('tls', createTlsServer(server, serve));
  await listen(
    'mutual',
    createTlsServer({ ...server, ca, requestCert: true, rejectUnauthorized: true }, serve),
  );
  const ws = createHttpServer();
  websocket(ws);
  await listen('ws', ws);
  const wss = createHttpsServer(server);
  websocket(wss);
  await listen('wss', wss);
});
afterAll(async () => {
  await Promise.all(
    servers.map((instance) => new Promise((resolve) => instance.close(() => resolve(null)))),
  );
});

let manager: MQTTConnectionManager;
afterEach(async () => {
  await manager?.disconnectAll();
  received.length = 0;
});
const connect = (config: Record<string, unknown>) => {
  manager = new MQTTConnectionManager();
  manager.on('error', () => {});
  return manager.connect('matrix', {
    protocolVersion: 5,
    reconnectPeriod: 0,
    connectTimeout: 5000,
    username: 'user',
    password: PASSWORD,
    ...config,
  } as BrokerConfig);
};
const tls = (port: number, options: Record<string, unknown>) => ({
  brokerUrl: `mqtts://127.0.0.1:${port}`,
  tls: { enabled: true, rejectUnauthorized: true, ...options },
});

it('connects over TLS with the test CA and server name, and completes QoS 1 and 2', async () => {
  await connect(tls(ports.tls, { ca: file(ca), servername: 'localhost' }));
  await manager.publish('matrix', 'tls/qos', 'one', { qos: 1 });
  await manager.publish('matrix', 'tls/qos', 'two', { qos: 2 });
  expect(received.map((packet) => [packet.qos, packet.payload.toString()])).toEqual([
    [1, 'one'],
    [2, 'two'],
  ]);
});

it('rejects untrusted certificates and host name mismatches unless verification is off', async () => {
  await expect(connect(tls(ports.tls, { servername: 'localhost' }))).rejects.toThrow(
    /self[- ]signed|unable to (verify|get)/i,
  );
  await manager.disconnectAll();
  // The certificate names only localhost, not 127.0.0.1.
  await expect(connect(tls(ports.tls, { ca: file(ca) }))).rejects.toThrow(/altnames|hostname/i);
  await manager.disconnectAll();
  await expect(connect(tls(ports.tls, { rejectUnauthorized: false }))).resolves.toMatchObject({
    id: 'matrix',
  });
});

it('presents client certificates for mutual TLS, including passphrase-protected keys', async () => {
  const base = { ca: file(ca), servername: 'localhost' };
  await expect(connect(tls(ports.mutual, base))).rejects.toThrow();
  await manager.disconnectAll();
  await expect(
    connect(tls(ports.mutual, { ...base, cert: file(client.cert), key: file(client.key) })),
  ).resolves.toMatchObject({ id: 'matrix' });
  await manager.disconnectAll();
  const encrypted = {
    ...base,
    cert: file(client.cert),
    key: file(fixture('client-encrypted.key')),
  };
  await expect(
    connect(tls(ports.mutual, { ...encrypted, passphrase: 'test-only-passphrase' })),
  ).resolves.toMatchObject({ id: 'matrix' });
  await manager.disconnectAll();
  await expect(connect(tls(ports.mutual, { ...encrypted, passphrase: 'wrong' }))).rejects.toThrow();
});

it('connects over WebSocket and secure WebSocket paths', async () => {
  await connect({ brokerUrl: `ws://127.0.0.1:${ports.ws}`, wsPath: '/mqtt' });
  await manager.publish('matrix', 'ws/qos', 'ws', { qos: 1 });
  await manager.disconnectAll();
  await expect(
    connect({ brokerUrl: `ws://127.0.0.1:${ports.ws}`, wsPath: '/wrong' }),
  ).rejects.toThrow();
  await manager.disconnectAll();
  await connect({
    ...tls(ports.wss, { ca: file(ca), servername: 'localhost' }),
    brokerUrl: `wss://127.0.0.1:${ports.wss}`,
    wsPath: '/mqtt',
  });
  await manager.publish('matrix', 'wss/qos', 'wss', { qos: 2 });
  expect(received.map((packet) => packet.topic)).toEqual(['ws/qos', 'wss/qos']);
});

it('reports rejected credentials for MQTT 3.1.1 and 5', async () => {
  for (const protocolVersion of [4, 5])
    await expect(
      connect({
        brokerUrl: `mqtts://127.0.0.1:${ports.tls}`,
        protocolVersion,
        password: 'wrong',
        tls: { enabled: true, ca: file(ca), servername: 'localhost' },
      }),
    ).rejects.toThrow(/user ?name or password|not authorized/i);
});
