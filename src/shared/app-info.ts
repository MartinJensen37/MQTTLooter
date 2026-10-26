/** Project facts for Help > About. The version comes from package.json at runtime. */
export const APP_INFO = {
  name: 'MQTTLooter',
  repository: 'https://github.com/MartinJensen37/MQTTLooter',
  license: 'MIT',
  copyright: 'Copyright © 2025-2026 MartinJensen37',
} as const;

/** Versions of the app and the runtime it ships with. */
export interface AppVersions {
  app: string;
  electron: string;
  chrome: string;
  node: string;
}

/** What the window adds to a diagnostics file: settings and connection options, without hosts or secrets. */
export interface WindowDiagnostics {
  settings: Record<string, unknown>;
  storageVersion: number;
  connections: Record<string, unknown>[];
  topicTrees: Record<string, unknown>[];
}
