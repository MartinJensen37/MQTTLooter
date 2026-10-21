import type { Recording, RecordedMessage } from '../../../../../shared/recording';
export type { Recording, RecordedMessage };

/** A recording prepared for playback. */
export interface CurrentPlayback extends Recording {
  originalMessages: RecordedMessage[];
}
