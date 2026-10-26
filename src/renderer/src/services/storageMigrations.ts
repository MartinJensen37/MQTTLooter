/**
 * Versions the data the window keeps in localStorage. When a saved format changes, raise
 * STORAGE_VERSION and add a migration that upgrades data saved by the previous version, with a
 * test. Migrations run once, in order, before any panel reads its saved data.
 *
 * Message schemas keep their own version (MessageTemplateService), and data saved in main
 * (history and recording databases, credentials and decoders) is versioned where it is stored.
 */
export const STORAGE_VERSION = 1;
export const STORAGE_VERSION_KEY = 'mqtt-storage-version';

type Migration = (storage: Storage) => void;

const readJson = (storage: Storage, key: string): unknown => {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Migration n upgrades data saved at version n - 1. */
export const MIGRATIONS: Record<number, Migration> = {
  // 1.0.0. Development builds before it saved settings as "advanced settings" and kept one
  // Publishing draft for all connections.
  1: (storage) => {
    const legacy = readJson(storage, 'mqtt-advanced-settings');
    if (isObject(legacy)) {
      const current = readJson(storage, 'mqtt-settings');
      storage.setItem(
        'mqtt-settings',
        JSON.stringify({ ...legacy, ...(isObject(current) ? current : {}) }),
      );
    }
    storage.removeItem('mqtt-advanced-settings');

    const draft = storage.getItem('publish-form-state');
    const connections = readJson(storage, 'mqtt-connections');
    if (draft !== null && Array.isArray(connections))
      for (const connection of connections) {
        const key = `publish-form-state-${connection?.id}`;
        if (typeof connection?.id === 'string' && storage.getItem(key) === null)
          storage.setItem(key, draft);
      }
    storage.removeItem('publish-form-state');
  },
};

/**
 * Brings saved data up to this build's format. Data saved by a newer version is left alone, so
 * running an older build never damages it; values it does not understand fall back to defaults.
 */
export function migrateStorage(storage: Storage = localStorage): {
  from: number;
  to: number;
} {
  const saved = Number(storage.getItem(STORAGE_VERSION_KEY) ?? 0);
  const from = Number.isSafeInteger(saved) && saved >= 0 ? saved : 0;
  if (from >= STORAGE_VERSION) return { from, to: from };
  for (let version = from + 1; version <= STORAGE_VERSION; version++) {
    MIGRATIONS[version](storage);
    // Recorded after each step, so an interrupted upgrade resumes where it stopped.
    storage.setItem(STORAGE_VERSION_KEY, String(version));
  }
  return { from, to: STORAGE_VERSION };
}
