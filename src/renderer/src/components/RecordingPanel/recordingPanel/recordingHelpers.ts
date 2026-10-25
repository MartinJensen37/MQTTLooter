import type { RecordingSummary } from './types';

/** Pretty-print a payload if it's JSON, otherwise return it unchanged. */
export function formatPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

/** Why a recording may be missing messages, or undefined when the capture was complete. */
export function incompleteDescription(recording: RecordingSummary): string | undefined {
  const parts: string[] = [];
  if (recording.incompleteReason) parts.push(recording.incompleteReason);
  if (recording.dropped)
    parts.push(
      `${recording.dropped.toLocaleString()} message${recording.dropped === 1 ? ' was' : 's were'} not recorded.`,
    );
  if (recording.outages)
    parts.push(
      `Connection lost ${recording.outages === 1 ? 'once' : `${recording.outages} times`} while recording.`,
    );
  return parts.length ? parts.join(' ') : undefined;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}
