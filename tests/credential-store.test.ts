import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CredentialStore, type SecretCipher } from '../src/main/credential-store';
import { mergeSecrets, splitSecrets, validateSecrets } from '../src/shared/credentials';

let directory: string;
let file: string;
let available: boolean;
// Reversible stand-in for safeStorage that visibly changes the bytes.
let rotate = false;
let nonce = 0;
const cipher: SecretCipher = {
  available: async () => available,
  encrypt: async (text) => Buffer.from(`enc:${nonce++}:${Buffer.from(text).toString('hex')}`),
  decrypt: async (data) => {
    const text = data.toString();
    if (!text.startsWith('enc:')) throw new Error('bad');
    return { result: Buffer.from(text.split(':')[2], 'hex').toString(), shouldReEncrypt: rotate };
  },
};
const key = { name: 'client.key', content: '-----BEGIN KEY-----', size: 19, lastModified: 1 };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'mqtt-credentials-'));
  file = join(directory, 'credentials.json');
  available = true;
  rotate = false;
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it('stores encrypted secrets, reports only flags and removes cleared entries', async () => {
  const store = new CredentialStore(file, cipher);
  await store.set('a', { password: 'hunter2', tlsKey: key, passphrase: 'sesame-77' });
  await store.set('b', { password: 'other-secret' });
  const raw = readFileSync(file, 'utf8');
  expect(raw).not.toMatch(/hunter2|BEGIN KEY|sesame-77|other-secret/);
  expect(await store.status()).toEqual({
    available: true,
    stored: {
      a: { password: true, tlsKey: true, passphrase: true },
      b: { password: true, tlsKey: false, passphrase: false },
    },
  });
  // A fresh instance reads the file back.
  const reopened = new CredentialStore(file, cipher);
  expect(await reopened.get('a')).toEqual({
    password: 'hunter2',
    tlsKey: key,
    passphrase: 'sesame-77',
  });
  // A rotated key re-encrypts the entry on read.
  rotate = true;
  const before = readFileSync(file, 'utf8');
  expect((await reopened.get('b'))?.password).toBe('other-secret');
  expect(readFileSync(file, 'utf8')).not.toBe(before);
  expect(readFileSync(file, 'utf8')).not.toMatch(/other-secret/);
  await reopened.set('a', {});
  await reopened.set('b', null);
  expect(await reopened.get('a')).toBeNull();
  expect((await reopened.status()).stored).toEqual({});
});

it('refuses to store without OS encryption and reports undecryptable entries', async () => {
  const store = new CredentialStore(file, cipher);
  available = false;
  await expect(store.set('a', { password: 'x' })).rejects.toThrow('unavailable');
  available = true;
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      entries: {
        a: { data: 'bm90LWVuY3J5cHRlZA==', password: true, tlsKey: false, passphrase: false },
      },
    }),
  );
  await expect(new CredentialStore(file, cipher).get('a')).rejects.toThrow(
    'could not be decrypted',
  );
  writeFileSync(file, '{"version":2}');
  await expect(new CredentialStore(file, cipher).status()).rejects.toThrow('Unsupported');
});

it('validates secrets arriving over IPC', () => {
  expect(() => validateSecrets({ password: 'x', token: 'y' })).toThrow('Unsupported');
  expect(() => validateSecrets({ password: 1 })).toThrow();
  expect(() => validateSecrets({ tlsKey: { name: 'k', content: 1 } })).toThrow('private key');
  expect(() => validateSecrets([])).toThrow();
  expect(validateSecrets({ passphrase: '' })).toEqual({ passphrase: '' });
});

it('splits secrets out of a config and merges them back without overriding entered values', () => {
  const config = {
    name: 'Broker',
    username: 'user',
    password: 'hunter2',
    tls: { enabled: true, ca: { content: 'CA' }, key, passphrase: 'sesame-77' },
  };
  const { config: stripped, secrets } = splitSecrets(config);
  expect(JSON.stringify(stripped)).not.toMatch(/hunter2|BEGIN KEY|sesame-77/);
  expect(stripped).toMatchObject({
    username: 'user',
    tls: { ca: { content: 'CA' }, key: { name: 'client.key', content: '' }, passphrase: '' },
  });
  expect(stripped).not.toHaveProperty('password');
  expect(mergeSecrets(stripped, secrets)).toEqual(config);
  expect(mergeSecrets({ ...stripped, password: 'typed' }, secrets).password).toBe('typed');
  expect(splitSecrets({ name: 'plain', tls: { enabled: false, key: null } }).secrets).toBeNull();
  expect(mergeSecrets(stripped, null)).toBe(stripped);
});
