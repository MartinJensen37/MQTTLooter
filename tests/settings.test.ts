// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const load = async () => (await import('../src/renderer/src/services/Settings')).settings;

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

it('starts from defaults and keeps choices from the old advanced settings', async () => {
  expect((await load()).snapshot()).toMatchObject({
    theme: 'light',
    textSize: 100,
    sparkplug: false,
  });
  localStorage.setItem('mqtt-advanced-settings', JSON.stringify({ protobufDecoders: true }));
  localStorage.setItem('mqtt-settings', JSON.stringify({ theme: 'dark', textSize: 999 }));
  // The window upgrades saved data before any service reads it.
  (await import('../src/renderer/src/services/storageMigrations')).migrateStorage();
  vi.resetModules();
  expect((await load()).snapshot()).toMatchObject({
    protobufDecoders: true,
    theme: 'dark',
    textSize: 100,
  });
});

it('saves valid changes, ignores invalid ones and notifies listeners', async () => {
  const settings = await load();
  const listener = vi.fn();
  settings.subscribe(listener);
  settings.set({ sparkplug: true, timeFormat: 'weekly' as never });
  expect(settings.snapshot()).toMatchObject({ sparkplug: true, timeFormat: 'system' });
  expect(JSON.parse(localStorage.getItem('mqtt-settings')!).sparkplug).toBe(true);
  expect(listener).toHaveBeenCalledOnce();
});
