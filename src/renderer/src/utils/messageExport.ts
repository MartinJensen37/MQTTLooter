import { CSV_HEADER, csvRow, exportRow } from '../../../shared/message-export';
import type { DisplayMessage } from '../services/TopicTreeService';

/** Export original payloads and normalized binary metadata, never display previews. */
export const exportMessage = (message: DisplayMessage) => exportRow(message);

export function exportMessageCSV(messages: DisplayMessage[]): string {
  return [CSV_HEADER, ...messages.map(csvRow)].join('\n');
}
