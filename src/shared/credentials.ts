/** Connection secrets kept out of renderer storage: broker password and TLS private key. */
export interface ConnectionSecrets {
  password?: string;
  tlsKey?: { name: string; content: string; size: number; lastModified: number };
  passphrase?: string;
}

export interface CredentialStatus {
  /** False when the OS cannot encrypt; secrets then stay in renderer storage as before. */
  available: boolean;
  /** Which connections have stored secrets. Values never cross IPC in status. */
  stored: Record<string, { password: boolean; tlsKey: boolean; passphrase: boolean }>;
}

export const CREDENTIAL_LIMITS = {
  maxConnections: 1000,
  maxSecretChars: 64 * 1024,
  maxKeyChars: 1024 * 1024,
};

type Config = Record<string, any>;

const hasSecrets = (secrets: ConnectionSecrets) =>
  Boolean(secrets.password || secrets.tlsKey || secrets.passphrase);

/** Split a connection config into what may be stored in the renderer and its secrets. */
export function splitSecrets<T extends Config>(
  config: T,
): {
  config: T;
  secrets: ConnectionSecrets | null;
} {
  const secrets: ConnectionSecrets = {};
  const stripped: Config = { ...config };
  if (typeof config.password === 'string' && config.password) secrets.password = config.password;
  delete stripped.password;
  if (config.tls && typeof config.tls === 'object') {
    const tls = { ...config.tls };
    if (tls.key?.content) secrets.tlsKey = tls.key;
    if (typeof tls.passphrase === 'string' && tls.passphrase) secrets.passphrase = tls.passphrase;
    // Keep the key's name so the editor can show which file is configured.
    tls.key = tls.key?.content ? { ...tls.key, content: '' } : (tls.key ?? null);
    tls.passphrase = '';
    stripped.tls = tls;
  }
  return { config: stripped as T, secrets: hasSecrets(secrets) ? secrets : null };
}

/** Values present in the config win; stored secrets fill only what is missing. */
export function mergeSecrets<T extends Config>(
  config: T,
  secrets: ConnectionSecrets | null | undefined,
): T {
  if (!secrets) return config;
  const merged: Config = { ...config };
  if (!merged.password && secrets.password) merged.password = secrets.password;
  if (secrets.tlsKey || secrets.passphrase) {
    const tls = { ...(merged.tls ?? {}) };
    if (!tls.key?.content && secrets.tlsKey) tls.key = secrets.tlsKey;
    if (!tls.passphrase && secrets.passphrase) tls.passphrase = secrets.passphrase;
    merged.tls = tls;
  }
  return merged as T;
}

/** Runtime validation for secrets arriving over IPC. */
export function validateSecrets(value: unknown): ConnectionSecrets {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid connection secrets');
  const { password, tlsKey, passphrase, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length) throw new Error('Unsupported connection secret');
  const text = (item: unknown, max: number) =>
    item === undefined || (typeof item === 'string' && item.length <= max);
  if (
    !text(password, CREDENTIAL_LIMITS.maxSecretChars) ||
    !text(passphrase, CREDENTIAL_LIMITS.maxSecretChars)
  )
    throw new Error('Invalid connection secret');
  if (tlsKey !== undefined) {
    const key = tlsKey as Record<string, unknown>;
    if (
      !key ||
      typeof key !== 'object' ||
      typeof key.name !== 'string' ||
      key.name.length > 1024 ||
      typeof key.content !== 'string' ||
      key.content.length > CREDENTIAL_LIMITS.maxKeyChars ||
      !Number.isFinite(key.size) ||
      !Number.isFinite(key.lastModified)
    )
      throw new Error('Invalid TLS private key');
  }
  return {
    ...(password !== undefined && { password: password as string }),
    ...(passphrase !== undefined && { passphrase: passphrase as string }),
    ...(tlsKey !== undefined && { tlsKey: tlsKey as ConnectionSecrets['tlsKey'] }),
  };
}
