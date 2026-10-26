import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkerClient } from '../src/main/worker-client';
import { HistoryService } from '../src/main/history-service';

// Stand-in workers: they answer every request except `search`, which never returns.
const directory = mkdtempSync(join(tmpdir(), 'worker-client-'));
const script = join(directory, 'worker.cjs');
writeFileSync(
  script,
  `const { parentPort, workerData } = require('node:worker_threads');
let decoders = 0;
parentPort.on('message', ({ requestId, request }) => {
  if (request.action === 'search') return;
  if (request.action === 'decoders') decoders = request.decoders.length;
  parentPort.postMessage({ requestId, data: { restart: workerData.restart === true, decoders } });
});`,
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('gives a request its full time awake, however long the computer slept', async () => {
  const onFailure = vi.fn();
  const client = new WorkerClient<{ action: string }>(
    script,
    {},
    { name: 'Test', maxPending: () => 8, onFailure, timeoutMs: 4000 },
  );
  expect(await client.request({ action: 'status' })).toMatchObject({ restart: false });
  const hanging = client.request({ action: 'search' });
  hanging.catch(() => {});
  // Asleep for an hour: the clock jumps while no timer runs.
  vi.setSystemTime(Date.now() + 3_600_000);
  await vi.advanceTimersByTimeAsync(2000);
  expect(onFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000);
  expect(onFailure).toHaveBeenCalledWith('Test worker stopped responding.');
  await expect(hanging).rejects.toThrow('stopped responding');
  await expect(client.request({ action: 'status' })).rejects.toThrow('stopped responding');
});

it('restarts a stopped history worker on resume, keeping the session and decoders', async () => {
  const service = new HistoryService(directory, script);
  await service.request({ action: 'decoders', decoders: [{ id: 'd' } as never] });
  const hanging = service.request({ action: 'search', query: {} as never });
  hanging.catch(() => {});
  await vi.advanceTimersByTimeAsync(11_000);
  expect(service.status().error).toBe('History worker stopped responding.');
  const resumed = await service.resume();
  expect(resumed.error).toBeUndefined();
  // The new worker keeps this session's database and has the decoders again.
  expect(resumed.store).toMatchObject({ restart: true, decoders: 1 });
  await service.close();
});
