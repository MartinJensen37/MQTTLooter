import type { RecordedMessage } from './types';

/** Sorted, de-duplicated list of topics across a message set. */
export function getUniqueTopics(messages: RecordedMessage[]): string[] {
  return Array.from(new Set(messages.map((msg) => msg.topic))).sort();
}

/** Filter messages to the selected topics (empty filter = all messages). */
export function getFilteredMessagesFor(
  messages: RecordedMessage[],
  selectedTopicsFilter: string[],
): RecordedMessage[] {
  if (selectedTopicsFilter.length === 0) return messages;
  return messages.filter((msg) => selectedTopicsFilter.includes(msg.topic));
}

/** Pretty-print a payload if it's JSON, otherwise return it unchanged. */
export function formatPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}
