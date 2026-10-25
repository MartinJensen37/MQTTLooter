import { describe, expect, it } from 'vitest';
import { encodePayload, payloadBytes, formatPayloadBytes } from '../src/shared/payload';
import { parseRecording } from '../src/shared/recording';

describe('payload fidelity', () => {
  it('round-trips all byte values, empty payloads, UTF-8 and a BOM', () => {
    const fixtures = [
      Uint8Array.from({ length: 256 }, (_, i) => i),
      new Uint8Array(),
      new TextEncoder().encode('\uFEFFhello\u0000\uFFFD\u{1F321}'),
      Uint8Array.of(0xc0, 0x80, 0xff),
    ];
    for (const bytes of fixtures) {
      const encoded = encodePayload(bytes);
      expect(payloadBytes(encoded.message, encoded.encoding)).toEqual(bytes);
      expect(encoded.byteLength).toBe(bytes.length);
    }
    expect(encodePayload(fixtures[0]).encoding).toBe('base64');
    expect(encodePayload(fixtures[2]).encoding).toBe('utf8');
  });

  it('validates canonical base64 without failing on large inputs', () => {
    for (const invalid of ['Zg', 'Zg=\n', 'Zh==', '====', '=AAA', 'AA=A', 'A===', 'a_==']) {
      expect(() => payloadBytes(invalid, 'base64')).toThrow();
    }
    expect(() => payloadBytes('abc', 'hex' as any)).toThrow('encoding');
    const bytes = new Uint8Array(2 * 1024 * 1024).fill(255);
    const encoded = encodePayload(bytes);
    expect(
      Buffer.compare(
        Buffer.from(payloadBytes(encoded.message, encoded.encoding)),
        Buffer.from(bytes),
      ),
    ).toBe(0);
    expect(formatPayloadBytes('/wAB', 'base64', 'hex')).toBe('ff 00 01');
    expect(formatPayloadBytes('/wAB', 'base64', 'hex', 1)).toContain('2 more bytes');
  });

  it('preserves binary bytes through saved and exported recording formats', () => {
    const bytes = Uint8Array.of(0, 255, 128, 13, 10);
    const { message, encoding } = encodePayload(bytes);
    const recording = {
      id: 1,
      name: 'Bytes',
      startTime: new Date(1),
      endTime: new Date(2),
      connectionName: 'Broker',
      messages: [{ topic: 'bytes', message, encoding, qos: 0, retain: true, timestamp: 1 }],
    };
    const exported = JSON.parse(
      JSON.stringify({
        recordingInfo: recording,
        messages: recording.messages.map(({ message, ...rest }) => ({ ...rest, payload: message })),
      }),
    );
    for (const data of [JSON.parse(JSON.stringify(recording)), exported]) {
      const imported = parseRecording(data).messages[0];
      expect(payloadBytes(imported.message, imported.encoding)).toEqual(bytes);
      expect(imported).toMatchObject({ qos: 0, retain: true, topic: 'bytes' });
    }
    const legacy = {
      ...recording,
      messages: [{ topic: 'text', message: 'old text', timestamp: 1 }],
    };
    expect(parseRecording(legacy).messages[0].encoding).toBe('utf8');
    expect(() =>
      parseRecording({ ...recording, messages: [{ ...recording.messages[0], message: 'bad' }] }),
    ).toThrow();
  });
});
