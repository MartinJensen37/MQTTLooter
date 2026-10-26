import { expect, it, vi } from 'vitest';
import { Updates, type Updater } from '../src/main/updates';

function setup({
  packaged = true,
  latest = '1.1.0',
  available = true,
  answers = [] as number[],
} = {}) {
  const updater: Updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    allowDowngrade: true,
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: available,
      updateInfo: { version: latest },
    })),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
  };
  const messages: { message?: string; detail?: string; type?: string }[] = [];
  const showMessage = vi.fn(async (_window, options) => {
    messages.push(options);
    return { response: answers.shift() ?? 0, checkboxChecked: false };
  });
  const openReleases = vi.fn();
  const updates = new Updates({
    updater,
    packaged,
    version: '1.0.0',
    window: () => null,
    showMessage,
    openReleases,
  });
  return { updates, updater, messages, openReleases };
}

it('never downloads or installs without asking, and offers betas only on the beta channel', () => {
  const { updates, updater } = setup();
  expect(updater.autoDownload).toBe(false);
  expect(updater.autoInstallOnAppQuit).toBe(false);
  expect(updater.allowPrerelease).toBe(false);
  expect(updater.allowDowngrade).toBe(false);
  updates.setChannel('beta');
  expect(updater.allowPrerelease).toBe(true);
  updates.setChannel('stable');
  expect(updater.allowPrerelease).toBe(false);
});

it('downloads after the user agrees and restarts to install when asked', async () => {
  const { updates, updater, messages } = setup({ answers: [0, 0] });
  await updates.check(true);
  expect(messages.map((message) => message.message)).toEqual([
    'MQTTLooter 1.1.0 is available',
    'MQTTLooter 1.1.0 is ready to install',
  ]);
  expect(updater.downloadUpdate).toHaveBeenCalledOnce();
  expect(updater.quitAndInstall).toHaveBeenCalledOnce();
});

it('installs a downloaded update on quit when the user restarts later', async () => {
  const { updates, updater } = setup({ answers: [0, 1] });
  await updates.check(false);
  expect(updater.quitAndInstall).not.toHaveBeenCalled();
  expect(updater.autoInstallOnAppQuit).toBe(true);
});

it('opens the release notes or waits, without downloading', async () => {
  const notes = setup({ answers: [1] });
  await notes.updates.check(true);
  expect(notes.openReleases).toHaveBeenCalledOnce();
  expect(notes.updater.downloadUpdate).not.toHaveBeenCalled();
  const later = setup({ answers: [2] });
  await later.updates.check(true);
  expect(later.updater.downloadUpdate).not.toHaveBeenCalled();
});

it('reports up to date and errors only for a manual check', async () => {
  const quiet = setup({ available: false });
  await quiet.updates.check(false);
  expect(quiet.messages).toEqual([]);
  await quiet.updates.check(true);
  expect(quiet.messages[0].message).toBe('MQTTLooter is up to date');

  const failing = setup();
  vi.mocked(failing.updater.checkForUpdates).mockRejectedValue(new Error('offline'));
  await failing.updates.check(false);
  expect(failing.messages).toEqual([]);
  await failing.updates.check(true);
  expect(failing.messages[0]).toMatchObject({ type: 'error', detail: 'offline' });
});

it('does not check from a development build', async () => {
  const { updates, updater, messages } = setup({ packaged: false });
  await updates.check(false);
  expect(messages).toEqual([]);
  await updates.check(true);
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
  expect(messages[0].message).toBe('Updates are available in the installed app');
});
