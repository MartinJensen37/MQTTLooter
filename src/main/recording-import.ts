import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { RecordingFileScanner } from './recording-file-scanner';
import type { RecordingDatabase } from './recording-database';
import {
  parseRecordedMessage,
  parseRecordingInfo,
  type RecordingSummary,
} from '../shared/recording';

const STEP_BYTES = 4 * 1024 * 1024;

export type ImportStep =
  | { done: false; bytes: number; total: number; messages: number }
  | { done: true; summary: RecordingSummary };

/**
 * Reads a recording file in bounded steps into a hidden recording, so a file of any size is
 * imported with bounded memory and the worker stays responsive between steps.
 */
export class RecordingImport {
  readonly recordingId: number;
  private fd: number;
  private position = 0;
  private total: number;
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private scanner = new RecordingFileScanner();
  private buffer = Buffer.alloc(STEP_BYTES);

  constructor(
    private database: RecordingDatabase,
    path: string,
  ) {
    this.fd = openSync(path, 'r');
    this.total = fstatSync(this.fd).size;
    this.recordingId = database.beginImport();
  }

  step(): ImportStep {
    try {
      const read = readSync(this.fd, this.buffer, 0, STEP_BYTES, this.position);
      this.position += read;
      const text = read
        ? this.decoder.decode(this.buffer.subarray(0, read), { stream: true })
        : this.decoder.decode();
      const messages = this.scanner.feed(text).map((value: any) => {
        // Exported files name the payload `payload`; saved libraries name it `message`.
        const message = parseRecordedMessage(value, typeof value?.payload === 'string');
        return { ...message, timestamp: message.timestamp.getTime() };
      });
      if (messages.length) this.database.appendImport(this.recordingId, messages);
      if (read)
        return {
          done: false,
          bytes: this.position,
          total: this.total,
          messages: this.scanner.messages,
        };
      this.scanner.end();
      const fields = this.scanner.fields;
      const info = parseRecordingInfo(fields.recordingInfo ?? fields);
      this.close();
      return {
        done: true,
        summary: this.database.finishImport(this.recordingId, {
          ...info,
          name: `${info.name} (Imported)`,
        }),
      };
    } catch (error) {
      this.abort();
      throw error;
    }
  }

  abort(): void {
    this.close();
    this.database.abortImport(this.recordingId);
  }

  private close(): void {
    if (this.fd < 0) return;
    closeSync(this.fd);
    this.fd = -1;
  }
}
