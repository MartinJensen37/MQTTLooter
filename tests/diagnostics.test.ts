// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { buildDiagnostics, RecentLog } from '../src/main/diagnostics';
import { connectionOptions } from '../src/renderer/src/utils/diagnostics';

it('keeps the latest warnings and errors while still printing them', () => {
  const printed: unknown[][] = [];
  const target = {
    warn: (...values: unknown[]) => printed.push(values),
    error: (...values: unknown[]) => printed.push(values),
  };
  const log = new RecentLog(2);
  log.capture(target);
  target.warn('first');
  target.error('second', new Error('broken'));
  target.error('third');
  expect(printed).toHaveLength(3);
  const entries = log.entries();
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatch(/ error second Error: broken/);
  expect(entries[1]).toMatch(/ error third$/);
});

it('describes a connection without its address, name, user or secrets', () => {
  const options = connectionOptions(
    {
      name: 'Plant broker',
      brokerUrl: 'mqtts://broker.example.com:8883',
      clientId: 'client-7',
      username: 'operator',
      password: 'secret',
      protocolVersion: 5,
      tls: { enabled: true, rejectUnauthorized: false, cert: { content: 'PEM' } },
      subscriptions: [{ topic: 'plant/#' }],
      willEnabled: true,
    },
    true,
  );
  expect(options).toMatchObject({
    transport: 'mqtts',
    port: '8883',
    protocolVersion: 5,
    tls: true,
    verifyCertificate: false,
    clientCertificate: true,
    subscriptions: 1,
    lastWill: true,
    connected: true,
  });
  const text = JSON.stringify(options);
  for (const hidden of ['broker.example.com', 'Plant broker', 'client-7', 'operator', 'secret'])
    expect(text).not.toContain(hidden);
});

it('combines versions, system, window and storage status into one report', () => {
  vi.useFakeTimers({ now: new Date('2026-10-27T10:00:00Z') });
  const report = buildDiagnostics({
    versions: { app: '1.0.0' },
    window: { settings: {}, storageVersion: 1, connections: [], topicTrees: [] },
    history: { persistent: false },
    recordings: { active: [] },
    delivery: { pendingMessages: 0 },
    log: ['line'],
  });
  vi.useRealTimers();
  expect(report.createdAt).toBe('2026-10-27T10:00:00.000Z');
  expect(report.system.platform).toBe(process.platform);
  expect(report.recentLog).toEqual(['line']);
});
