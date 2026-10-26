import { arch, release, totalmem } from 'node:os';
import type { WindowDiagnostics } from '../shared/app-info';

/** Recent warnings and errors from the main process, for a diagnostics file. */
export class RecentLog {
  private lines: string[] = [];

  constructor(private readonly limit = 200) {}

  add(level: 'warn' | 'error', values: unknown[]): void {
    const text = values
      .map((value) => (value instanceof Error ? value.stack || value.message : String(value)))
      .join(' ');
    this.lines.push(`${new Date().toISOString()} ${level} ${text}`.slice(0, 2000));
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit);
  }

  /** Keeps every warning and error printed by main, without changing what is printed. */
  capture(target: Pick<Console, 'warn' | 'error'> = console): void {
    for (const level of ['warn', 'error'] as const) {
      const original = target[level].bind(target);
      target[level] = (...values: unknown[]) => {
        this.add(level, values);
        original(...values);
      };
    }
  }

  entries(): string[] {
    return [...this.lines];
  }
}

/**
 * The contents of a diagnostics file for a bug report. Topics, payloads, broker addresses and
 * credentials are left out; recent log lines may still name a broker address in an error.
 */
export function buildDiagnostics(parts: {
  versions: Record<string, string>;
  window: WindowDiagnostics;
  history: unknown;
  recordings: unknown;
  delivery: unknown;
  log: string[];
  now?: Date;
}) {
  return {
    createdAt: (parts.now ?? new Date()).toISOString(),
    versions: parts.versions,
    system: {
      platform: process.platform,
      release: release(),
      arch: arch(),
      memoryGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
    },
    window: parts.window,
    history: parts.history,
    recordings: parts.recordings,
    delivery: parts.delivery,
    recentLog: parts.log,
  };
}
