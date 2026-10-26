// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import {
  MIGRATIONS,
  STORAGE_VERSION,
  STORAGE_VERSION_KEY,
  migrateStorage,
} from '../src/renderer/src/services/storageMigrations';

beforeEach(() => localStorage.clear());

it('has one migration for every version', () => {
  for (let version = 1; version <= STORAGE_VERSION; version++)
    expect(MIGRATIONS[version], `migration ${version}`).toBeTypeOf('function');
});

it('starts a fresh install at the current version', () => {
  expect(migrateStorage()).toEqual({ from: 0, to: STORAGE_VERSION });
  expect(localStorage.getItem(STORAGE_VERSION_KEY)).toBe(String(STORAGE_VERSION));
});

it('moves development-build settings and the shared Publishing draft into the 1.0.0 formats', () => {
  localStorage.setItem(
    'mqtt-advanced-settings',
    JSON.stringify({ protobufDecoders: true, theme: 'light' }),
  );
  localStorage.setItem('mqtt-settings', JSON.stringify({ theme: 'dark' }));
  localStorage.setItem('publish-form-state', JSON.stringify({ topic: 'shared' }));
  localStorage.setItem('publish-form-state-b', JSON.stringify({ topic: 'own' }));
  localStorage.setItem(
    'mqtt-connections',
    JSON.stringify([{ id: 'a' }, { id: 'b' }, { name: 'no id' }]),
  );
  migrateStorage();
  // The newer settings win over the legacy ones.
  expect(JSON.parse(localStorage.getItem('mqtt-settings')!)).toEqual({
    protobufDecoders: true,
    theme: 'dark',
  });
  expect(localStorage.getItem('mqtt-advanced-settings')).toBeNull();
  expect(JSON.parse(localStorage.getItem('publish-form-state-a')!).topic).toBe('shared');
  expect(JSON.parse(localStorage.getItem('publish-form-state-b')!).topic).toBe('own');
  expect(localStorage.getItem('publish-form-state')).toBeNull();
});

it('survives unreadable saved data and runs each migration only once', () => {
  localStorage.setItem('mqtt-advanced-settings', '{broken');
  localStorage.setItem('mqtt-connections', 'not json');
  localStorage.setItem('publish-form-state', '{}');
  expect(() => migrateStorage()).not.toThrow();
  localStorage.setItem('mqtt-advanced-settings', JSON.stringify({ sparkplug: true }));
  expect(migrateStorage()).toEqual({ from: STORAGE_VERSION, to: STORAGE_VERSION });
  expect(localStorage.getItem('mqtt-advanced-settings')).not.toBeNull();
});

it('leaves data saved by a newer version untouched', () => {
  localStorage.setItem(STORAGE_VERSION_KEY, String(STORAGE_VERSION + 1));
  localStorage.setItem('publish-form-state', '{}');
  expect(migrateStorage()).toEqual({ from: STORAGE_VERSION + 1, to: STORAGE_VERSION + 1 });
  expect(localStorage.getItem('publish-form-state')).toBe('{}');
});
