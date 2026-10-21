/** JSON-safe payload representation shared by IPC, history and recording files. */
export type PayloadEncoding = 'utf8' | 'base64';

export function payloadBytes(message: string, encoding: PayloadEncoding = 'utf8'): Uint8Array {
  if (typeof message !== 'string') throw new Error('Payload must be a string');
  if (encoding === 'utf8') return new TextEncoder().encode(message);
  if (encoding !== 'base64') throw new Error('Unsupported payload encoding');
  if (message.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(message) || /=[^=]|={3}/.test(message)) {
    throw new Error('Invalid base64 payload');
  }
  const decoded = atob(message);
  if (btoa(decoded) !== message) throw new Error('Invalid base64 payload');
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

export function encodePayload(bytes: Uint8Array): {
  message: string;
  encoding: PayloadEncoding;
  byteLength: number;
} {
  try {
    // Preserve the BOM as data, and reject invalid UTF-8 rather than replacing bytes.
    const message = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return { message, encoding: 'utf8', byteLength: bytes.byteLength };
  } catch {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { message: btoa(binary), encoding: 'base64', byteLength: bytes.byteLength };
  }
}

export function formatPayloadBytes(
  message: string,
  encoding: PayloadEncoding = 'utf8',
  view: 'text' | 'hex' = 'hex',
  limit = 4096,
): string {
  const bytes = payloadBytes(message, encoding);
  const visible = bytes.subarray(0, limit);
  const text =
    view === 'text'
      ? new TextDecoder('utf-8', { ignoreBOM: true }).decode(visible)
      : Array.from(visible, (b) => b.toString(16).padStart(2, '0')).join(' ');
  return (
    text +
    (bytes.length > limit
      ? `\n… ${bytes.length - limit} more bytes (export for the full payload)`
      : '')
  );
}
