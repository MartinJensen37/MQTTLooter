import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron';

/** The parts of electron-updater's autoUpdater used here. */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  checkForUpdates(): Promise<{
    isUpdateAvailable?: boolean;
    updateInfo: { version: string };
  } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateDependencies {
  updater: Updater;
  /** Installed builds only; a development build has no update feed. */
  packaged: boolean;
  version: string;
  window: () => BrowserWindow | null;
  showMessage: (
    window: BrowserWindow | null,
    options: MessageBoxOptions,
  ) => Promise<MessageBoxReturnValue>;
  openReleases: () => void;
}

export type UpdateChannel = 'stable' | 'beta';

/**
 * Checks GitHub Releases for a newer version: quietly at startup, or from
 * Help > Check for updates. Nothing downloads or installs without the user agreeing.
 * The beta channel also offers pre-releases.
 */
export class Updates {
  private busy = false;

  constructor(private readonly deps: UpdateDependencies) {
    deps.updater.autoDownload = false;
    deps.updater.autoInstallOnAppQuit = false;
    deps.updater.allowPrerelease = false;
    deps.updater.allowDowngrade = false;
  }

  setChannel(channel: UpdateChannel): void {
    this.deps.updater.allowPrerelease = channel === 'beta';
  }

  /** `manual` reports every outcome; the startup check only speaks up when there is an update. */
  async check(manual: boolean): Promise<void> {
    const { updater, version } = this.deps;
    if (!this.deps.packaged) {
      if (manual)
        await this.message({
          type: 'info',
          message: 'Updates are available in the installed app',
          detail: 'This is a development build, which is not updated automatically.',
        });
      return;
    }
    if (this.busy) return;
    this.busy = true;
    try {
      const result = await updater.checkForUpdates();
      const latest = result?.updateInfo.version;
      if (!result?.isUpdateAvailable || !latest) {
        if (manual)
          await this.message({
            type: 'info',
            message: 'MQTTLooter is up to date',
            detail: `Version ${version} is the latest version.`,
          });
        return;
      }
      const choice = await this.message({
        type: 'info',
        message: `MQTTLooter ${latest} is available`,
        detail: `You have version ${version}. Download the update now? It installs when you restart.`,
        buttons: ['Download', 'Release notes', 'Later'],
        defaultId: 0,
        cancelId: 2,
      });
      if (choice.response === 1) this.deps.openReleases();
      if (choice.response !== 0) return;
      await updater.downloadUpdate();
      const restart = await this.message({
        type: 'info',
        message: `MQTTLooter ${latest} is ready to install`,
        detail: 'Restart now to install it, or it installs the next time you close MQTTLooter.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (restart.response === 0) updater.quitAndInstall();
      else updater.autoInstallOnAppQuit = true;
    } catch (error) {
      if (manual)
        await this.message({
          type: 'error',
          message: 'Could not check for updates',
          detail: (error as Error).message,
        });
    } finally {
      this.busy = false;
    }
  }

  private message(options: MessageBoxOptions) {
    return this.deps.showMessage(this.deps.window(), { title: 'Updates', ...options });
  }
}
