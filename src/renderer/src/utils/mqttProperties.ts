import { payloadBytes } from '../../../shared/payload';

const LABELS: Record<string, string> = {
  payloadFormatIndicator: 'Payload format',
  messageExpiryInterval: 'Message expiry (seconds, as received)',
  topicAlias: 'Topic alias (as received)',
  responseTopic: 'Response topic',
  subscriptionIdentifier: 'Subscription identifier',
  contentType: 'Content type',
};
const MAX_ROWS = 64;
const MAX_TEXT = 1024;

export function propertyRows(properties: Record<string, unknown>) {
  const rows: { label: string; value: string }[] = [];
  let truncated = false;
  let rowLimit = false;
  const clip = (text: string, limit = MAX_TEXT) => {
    if (text.length <= limit) return text;
    truncated = true;
    return `${text.slice(0, limit)}…`;
  };
  const add = (label: string, value: unknown) => {
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      rowLimit = true;
      return false;
    }
    rows.push({
      label: clip(label, 128),
      value: clip(
        value === null
          ? 'null'
          : typeof value === 'object'
            ? '[Structured value; copy properties to inspect]'
            : String(value),
      ),
    });
    return true;
  };
  for (const key in properties) {
    if (!Object.hasOwn(properties, key) || key === 'correlationData') continue;
    const value = properties[key];
    if (key === 'userProperties' && value && typeof value === 'object') {
      for (const name in value) {
        if (!Object.hasOwn(value, name)) continue;
        const values = (value as Record<string, unknown>)[name];
        for (const item of Array.isArray(values) ? values : [values]) {
          if (!add(`User: ${name}`, item)) break;
        }
        if (rowLimit) break;
      }
    } else if (key === 'payloadFormatIndicator') {
      add(
        LABELS[key],
        value === true || value === 1
          ? '1 — UTF-8'
          : value === false || value === 0
            ? '0 — Unspecified bytes'
            : value,
      );
    } else {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (!add(Object.hasOwn(LABELS, key) ? LABELS[key] : key, item)) break;
      }
    }
    if (rowLimit) break;
  }
  return { rows, truncated };
}

/** MQTT correlation data is binary, including when every byte happens to be UTF-8. */
export function correlationPreview(value: unknown) {
  try {
    let bytes: Uint8Array;
    if (value instanceof Uint8Array) bytes = value;
    else {
      const tagged = value as { encoding?: string; data?: string } | null;
      if (
        tagged?.encoding !== 'base64' ||
        typeof tagged.data !== 'string' ||
        tagged.data.length > 87380
      )
        throw new Error('Invalid binary property');
      bytes = payloadBytes(tagged.data, 'base64');
    }
    if (bytes.length > 65535) throw new Error('Invalid binary property');
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return {
      base64: btoa(binary),
      hex: Array.from(bytes.subarray(0, 256), (byte) => byte.toString(16).padStart(2, '0')).join(
        ' ',
      ),
      length: bytes.length,
    };
  } catch {
    return undefined;
  }
}
