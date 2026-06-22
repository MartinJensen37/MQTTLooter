// Shared types for the RecordingPanel and its section components.

export interface RecordedMessage {
  topic: string;
  message: string; // payload
  qos?: number;
  retain?: boolean;
  timestamp: Date | string | number;
  connectionId?: string;
  [key: string]: unknown;
}

export interface Recording {
  id: number;
  name: string;
  startTime: Date;
  endTime: Date;
  messageCount: number;
  messages: RecordedMessage[];
  topic: string;
  connectionName: string;
}

/** A recording prepared for playback (carries the unfiltered message list). */
export interface CurrentPlayback extends Recording {
  originalMessages: RecordedMessage[];
}
