export const MQTT_DEFAULTS = {
  HOSTNAME: 'localhost',
  PORTS: {
    mqtt: 1883,
    mqtts: 8883,
    ws: 80,
    wss: 443,
  },
  KEEPALIVE: 60,
  CONNECT_TIMEOUT: 30000,
  RECONNECT_PERIOD: 1000,
  PROTOCOL_VERSION: 4,
};

export const MESSAGE_HISTORY = {
  MAX_ITEMS_PER_TOPIC: 300,
  /** Choices for the messages each topic keeps in the live cache (Settings). */
  ITEMS_PER_TOPIC_CHOICES: [100, 300, 500, 1000, 2000],
  MAX_BYTES_PER_TOPIC: 2 * 1024 * 1024, // 2MB
  COMPACTION_FACTOR: 10,
};

export const CONNECTION_HISTORY = {
  maxBytes: 64 * 1024 * 1024, // Estimated retained storage, not process RSS.
  maxNodes: 20000,
  maxMessages: 50000,
  maxDepth: 128,
};

export const HISTORY_PROFILES = {
  compact: { ...CONNECTION_HISTORY, maxBytes: 32 * 1024 * 1024, maxNodes: 5000 },
  larger: { ...CONNECTION_HISTORY },
};
export type HistoryProfile = keyof typeof HISTORY_PROFILES;
export const HISTORY_BUDGET = { maxBytes: 128 * 1024 * 1024, maxPinnedTopics: 8 };

export const UI = {
  RATE_UPDATE_INTERVAL_MS: 100,
  RATE_EMIT_INTERVAL_MS: 250,
  CONNECTION_SWITCH_DELAY_MS: 246,
  DEV_SERVER_URL: 'http://localhost:3000',
};
