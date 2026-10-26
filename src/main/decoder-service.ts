import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkerClient } from './worker-client';
import {
  DECODER_LIMITS,
  validateDecoders,
  type DecoderDefinition,
  type DecoderRequest,
} from '../shared/decoders';
import type { PayloadEncoding } from '../shared/payload';
import type { SparkplugOutgoingPayload } from '../shared/sparkplug';

/** Saved decoder definitions, compiled and applied in a worker. */
export class DecoderService {
  private worker: WorkerClient<DecoderRequest>;
  private decoders: DecoderDefinition[] = [];
  private errors: Record<string, string> = {};
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  /** `onChange` receives the definitions after loading and after every save. */
  constructor(
    private readonly file: string,
    workerPath = join(__dirname, 'decoder-worker.js'),
    private readonly onChange: (decoders: DecoderDefinition[]) => void = () => {},
  ) {
    this.worker = new WorkerClient(
      workerPath,
      {},
      {
        name: 'Decoder',
        // A virtualized message list decodes only visible cards, a few dozen at a time;
        // births arrive in bursts when many edge nodes come online.
        maxPending: (request) =>
          request.action === 'observe' ? 1024 : request.action === 'decode' ? 64 : 8,
        onFailure: () => {},
      },
    );
    this.ready = this.load().catch((error) => {
      this.errors = { file: `Saved decoders could not be loaded: ${(error as Error).message}` };
    });
  }

  private async load(): Promise<void> {
    try {
      // JSON escaping can double the size of .proto text.
      const maxBytes = DECODER_LIMITS.maxDecoders * DECODER_LIMITS.maxTotalProtoChars * 2;
      if ((await stat(this.file)).size > maxBytes) throw new Error('Decoder file is too large');
      this.decoders = validateDecoders(JSON.parse(await readFile(this.file, 'utf8')).decoders);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    this.errors = await this.worker.request({ action: 'configure', decoders: this.decoders });
    this.onChange(this.decoders);
  }

  async list(): Promise<{ decoders: DecoderDefinition[]; errors: Record<string, string> }> {
    await this.ready;
    return { decoders: this.decoders, errors: this.errors };
  }

  /** Compile before saving; a definition that does not compile is rejected, not stored. */
  save(value: unknown): Promise<DecoderDefinition[]> {
    const task = this.queue.then(async () => {
      await this.ready;
      const decoders = validateDecoders(value);
      const errors: Record<string, string> = await this.worker.request({
        action: 'configure',
        decoders,
      });
      if (Object.keys(errors).length) {
        await this.worker.request({ action: 'configure', decoders: this.decoders });
        throw new Error(Object.values(errors).join('\n'));
      }
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify({ version: 1, decoders }), 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, this.file);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      this.decoders = decoders;
      this.errors = {};
      this.onChange(decoders);
      return decoders;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  types(sources: string[]): Promise<string[]> {
    return this.worker.request({ action: 'types', sources });
  }

  async decode(
    decoderId: string,
    message: string,
    encoding: PayloadEncoding,
    topic?: string,
  ): Promise<string> {
    await this.ready;
    return this.worker.request({ action: 'decode', decoderId, message, encoding, topic });
  }

  /** Sparkplug birth messages name the aliases that later data messages use. */
  observe(topic: string, message: string, encoding: PayloadEncoding): void {
    this.worker.request({ action: 'observe', topic, message, encoding }).catch(() => {});
  }

  /** Protobuf bytes for a Sparkplug B payload, base64-encoded for publishing. */
  encodeSparkplug(
    payload: SparkplugOutgoingPayload,
  ): Promise<{ message: string; encoding: 'base64'; byteLength: number }> {
    return this.worker.request({ action: 'encode-sparkplug', payload });
  }

  close(): Promise<void> {
    return this.worker.close({ action: 'close' });
  }
}
