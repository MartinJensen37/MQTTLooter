/*
 * Minimal loopback MQTT broker for load tests, run as a separate process so publishing cost does
 * not distort the app's main-process measurements. Controlled over the fork IPC channel:
 *   { type: 'retained', count, payloadBytes } sets the retained set sent on SUBSCRIBE.
 *   { type: 'stream', rate, seconds, topics, sizes, proto? } publishes live traffic and reports
 *   totals. With proto: { source, topics }, the first topics carry protobuf `load.Reading` payloads.
 * Never point this at a public broker; it only listens on 127.0.0.1.
 */
const net = require('node:net');
const { createRequire } = require('node:module');
const codec = createRequire(require.resolve('mqtt'))('mqtt-packet');
const protobuf = require('protobufjs');

const clients = new Set();
let retained = { count: 0, payloadBytes: 16 };
const payloadCache = new Map();
const payload = (bytes, value) => {
  // Mixed content: numeric text for small payloads, JSON for larger ones.
  if (bytes <= 16) return Buffer.from(String(value).padStart(Math.min(bytes, 12), '0'));
  let body = payloadCache.get(bytes);
  if (!body) {
    body = 'x'.repeat(Math.max(0, bytes - 40));
    payloadCache.set(bytes, body);
  }
  return Buffer.from(`{"value":${value},"pad":"${body}"}`);
};
// Deep and empty topic levels exercise the tree's ancestor bookkeeping.
const retainedTopic = (i) =>
  i % 10 === 0 ? `load/deep/${i % 7}//${i % 13}/${i}` : `load/r/${Math.floor(i / 100)}/${i % 100}`;

async function write(client, packet) {
  if (client.socket.destroyed) return false;
  if (!client.socket.write(codec.generate(packet, { protocolVersion: client.protocolVersion })))
    await new Promise((resolve) => {
      client.socket.once('drain', resolve);
      client.socket.once('close', resolve);
    });
  return !client.socket.destroyed;
}

async function sendRetained(client) {
  for (let i = 0; i < retained.count; i++)
    if (
      !(await write(client, {
        cmd: 'publish',
        topic: retainedTopic(i),
        payload: payload(retained.payloadBytes, i),
        qos: 0,
        retain: true,
      }))
    )
      return;
  process.send?.({ type: 'retainedSent', count: retained.count });
}

const server = net.createServer((socket) => {
  const client = { socket, protocolVersion: 4, subscribed: false };
  clients.add(client);
  socket.setNoDelay(true);
  socket.on('close', () => clients.delete(client));
  socket.on('error', () => {});
  const parser = codec.parser();
  parser.on('packet', (packet) => {
    if (packet.cmd === 'connect') {
      client.protocolVersion = packet.protocolVersion;
      void write(client, { cmd: 'connack', sessionPresent: false, returnCode: 0, reasonCode: 0 });
    } else if (packet.cmd === 'subscribe') {
      void write(client, {
        cmd: 'suback',
        messageId: packet.messageId,
        granted: packet.subscriptions.map(() => 0),
      }).then(() => {
        client.subscribed = true;
        return sendRetained(client);
      });
    } else if (packet.cmd === 'publish') {
      if (packet.qos === 1) void write(client, { cmd: 'puback', messageId: packet.messageId });
      if (packet.qos === 2) void write(client, { cmd: 'pubrec', messageId: packet.messageId });
    } else if (packet.cmd === 'pubrel') {
      void write(client, { cmd: 'pubcomp', messageId: packet.messageId });
    } else if (packet.cmd === 'pingreq') void write(client, { cmd: 'pingresp' });
  });
  parser.on('error', () => socket.destroy());
  socket.on('data', (data) => parser.parse(data));
});

/** Publish at a fixed rate in 10 ms ticks. Socket backpressure delays rather than drops. */
async function stream({ rate, seconds, topics, sizes, proto }) {
  const reading = proto && protobuf.parse(proto.source).root.lookupType('load.Reading');
  const started = Date.now();
  const end = started + seconds * 1000;
  let sent = 0;
  let bytes = 0;
  let behind = 0;
  while (Date.now() < end) {
    const due = Math.floor(((Date.now() - started) / 1000) * rate);
    const targets = [...clients].filter((client) => client.subscribed);
    while (sent < due) {
      const index = sent % topics;
      const encoded = reading && index < proto.topics;
      const body = encoded
        ? Buffer.from(
            reading.encode({ value: Math.sin(sent / 50), count: sent, id: `p${index}` }).finish(),
          )
        : payload(sizes[sent % sizes.length], sent);
      for (const client of targets)
        await write(client, {
          cmd: 'publish',
          topic: encoded ? `load/proto/${index}` : `load/live/${index}`,
          payload: body,
          qos: 0,
          retain: false,
        });
      sent++;
      bytes += body.length;
    }
    behind = Math.max(behind, Math.floor(((Date.now() - started) / 1000) * rate) - sent);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const elapsed = (Date.now() - started) / 1000;
  return { sent, bytes, elapsed, achievedRate: sent / elapsed, maxBacklog: behind };
}

process.on('message', async (message) => {
  if (message.type === 'retained') {
    retained = { count: message.count, payloadBytes: message.payloadBytes ?? 16 };
    process.send({ type: 'ok' });
  } else if (message.type === 'stream') {
    process.send({ type: 'streamDone', ...(await stream(message)) });
  } else if (message.type === 'stop') {
    for (const client of clients) client.socket.destroy();
    server.close(() => process.exit(0));
  }
});

server.listen(0, '127.0.0.1', () => process.send({ type: 'ready', port: server.address().port }));
