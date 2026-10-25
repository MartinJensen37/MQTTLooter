import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CREDENTIAL_LIMITS,
  validateSecrets,
  type ConnectionSecrets,
  type CredentialStatus,
} from '../shared/credentials';

/** OS-backed encryption, injected so the store can be tested without Electron. */
export interface SecretCipher {
  available(): Promise<boolean>;
  encrypt(text: string): Promise<Buffer>;
  /** `shouldReEncrypt` reports a rotated key; the entry is then written again. */
  decrypt(data: Buffer): Promise<{ result: string; shouldReEncrypt?: boolean }>;
}

interface Entry {
  /** Encrypted JSON of the secrets, base64. */
  data: string;
  password: boolean;
  tlsKey: boolean;
  passphrase: boolean;
}

/** Encrypted connection secrets in one small file, written atomically and serially. */
export class CredentialStore {
  private queue: Promise<unknown> = Promise.resolve();
  private entries?: Record<string, Entry>;

  constructor(
    private readonly file: string,
    private readonly cipher: SecretCipher,
  ) {}

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const task = this.queue.then(action);
    this.queue = task.catch(() => {});
    return task;
  }

  private async read(): Promise<Record<string, Entry>> {
    if (this.entries) return this.entries;
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data?.version !== 1 || !data.entries || typeof data.entries !== 'object')
        throw new Error('Unsupported credential file');
      for (const entry of Object.values(data.entries) as Entry[])
        if (typeof entry?.data !== 'string') throw new Error('Invalid credential file');
      this.entries = data.entries as Record<string, Entry>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.entries = {};
    }
    return this.entries;
  }

  private async write(entries: Record<string, Entry>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ version: 1, entries }), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.file);
      this.entries = entries;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  status(): Promise<CredentialStatus> {
    return this.enqueue(async () => {
      const entries = await this.read();
      return {
        available: await this.cipher.available(),
        stored: Object.fromEntries(
          Object.entries(entries).map(([id, { password, tlsKey, passphrase }]) => [
            id,
            { password, tlsKey, passphrase },
          ]),
        ),
      };
    });
  }

  get(connectionId: string): Promise<ConnectionSecrets | null> {
    return this.enqueue(async () => {
      const entries = await this.read();
      const entry = entries[connectionId];
      if (!entry) return null;
      if (!(await this.cipher.available())) throw new Error('OS encryption is unavailable');
      let secrets: ConnectionSecrets;
      let rotated: boolean | undefined;
      try {
        const decrypted = await this.cipher.decrypt(Buffer.from(entry.data, 'base64'));
        secrets = validateSecrets(JSON.parse(decrypted.result));
        rotated = decrypted.shouldReEncrypt;
      } catch {
        throw new Error('Saved credentials could not be decrypted. Enter them again.');
      }
      if (rotated)
        await this.write({
          ...entries,
          [connectionId]: {
            ...entry,
            data: (await this.cipher.encrypt(JSON.stringify(secrets))).toString('base64'),
          },
        });
      return secrets;
    });
  }

  /** Store secrets, or remove them when there are none. */
  set(connectionId: string, secrets: ConnectionSecrets | null): Promise<void> {
    return this.enqueue(async () => {
      const entries = { ...(await this.read()) };
      if (!secrets || !(secrets.password || secrets.tlsKey || secrets.passphrase)) {
        if (!(connectionId in entries)) return;
        delete entries[connectionId];
      } else {
        if (!(await this.cipher.available())) throw new Error('OS encryption is unavailable');
        const valid = validateSecrets(secrets);
        if (
          !(connectionId in entries) &&
          Object.keys(entries).length >= CREDENTIAL_LIMITS.maxConnections
        )
          throw new Error('Too many saved credentials');
        entries[connectionId] = {
          data: (await this.cipher.encrypt(JSON.stringify(valid))).toString('base64'),
          password: Boolean(valid.password),
          tlsKey: Boolean(valid.tlsKey),
          passphrase: Boolean(valid.passphrase),
        };
      }
      await this.write(entries);
    });
  }
}
