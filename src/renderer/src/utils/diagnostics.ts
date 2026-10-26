import type { WindowDiagnostics } from '../../../shared/app-info';
import type { ConnectionConfig } from '../../../shared/connection';
import TopicTreeService from '../services/TopicTreeService';
import { settings } from '../services/Settings';
import { STORAGE_VERSION } from '../services/storageMigrations';

/** Connection options that help with a bug report; addresses, names and secrets stay out. */
export function connectionOptions(config: ConnectionConfig, isConnected = false) {
  let url: URL | null = null;
  try {
    url = new URL(config.brokerUrl);
  } catch {
    /* Reported as an unknown transport. */
  }
  return {
    transport: url?.protocol.replace(':', '') ?? 'unknown',
    port: url?.port || null,
    protocolVersion: config.protocolVersion ?? 4,
    tls: Boolean(config.tls?.enabled),
    verifyCertificate: config.tls?.rejectUnauthorized !== false,
    clientCertificate: Boolean(config.tls?.cert),
    clean: config.clean !== false,
    keepalive: config.keepalive ?? 60,
    reconnectPeriod: config.reconnectPeriod ?? 1000,
    autoAssignTopicAlias: config.autoAssignTopicAlias === true,
    subscriptions: config.subscriptions?.length ?? 0,
    lastWill: config.willEnabled === true,
    connected: isConnected,
  };
}

/** The window's part of a diagnostics file. */
export function windowDiagnostics(
  connections: { id: string; config: ConnectionConfig; isConnected?: boolean }[],
): WindowDiagnostics {
  return {
    settings: { ...settings.snapshot(), cache: TopicTreeService.getHistorySettings() },
    storageVersion: STORAGE_VERSION,
    connections: connections.map((connection) =>
      connectionOptions(connection.config, connection.isConnected),
    ),
    topicTrees: connections.flatMap((connection) => {
      const statistics = TopicTreeService.getTopicTreeStatistics(connection.id);
      return statistics
        ? [
            {
              topics: statistics.totalNodes,
              messages: statistics.totalMessages,
              retainedBytes: statistics.retainedBytes,
              discardedMessages: statistics.discardedMessages,
              evictedTopics: statistics.evictedTopics,
              messageRate: statistics.totalRate,
            },
          ]
        : [];
    }),
  };
}
