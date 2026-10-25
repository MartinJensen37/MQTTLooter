import type {
  Recording,
  RecordedMessage,
  RecordingSummary,
  StoredRecordingMessage,
} from '../../../../../shared/recording';
export type { Recording, RecordedMessage, RecordingSummary, StoredRecordingMessage };

/** The expanded recording: available topics and the size of the current filter. */
export interface PlaybackState {
  recording: RecordingSummary;
  topics: string[];
  topicTotal: number;
  total: number;
}
