import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateValue } from '../src/renderer/src/utils/valueGenerators';
import { parseRecording } from '../src/renderer/src/components/RecordingPanel/recordingPanel/parseRecording';
import MessageTemplateService from '../src/renderer/src/services/MessageTemplateService';

afterEach(() => vi.restoreAllMocks());

describe('recording files', () => {
  it('preserves an incomplete-capture warning through save and export import', () => {
    const recording = {
      id: 1,
      name: 'A',
      startTime: new Date(0),
      endTime: new Date(1),
      connectionName: 'A',
      incompleteReason: 'Incoming message delivery has a gap.',
      messages: [{ topic: 'topic', message: 'payload', timestamp: 100, qos: 1, retain: true }],
    };
    expect(parseRecording(JSON.parse(JSON.stringify(recording))).incompleteReason).toBe(
      recording.incompleteReason,
    );
    expect(
      parseRecording({
        recordingInfo: recording,
        messages: recording.messages.map((m) => ({ ...m, payload: m.message })),
      }).incompleteReason,
    ).toBe(recording.incompleteReason);
  });
  it('keeps MQTT 5 metadata and rejects malformed metadata on import', () => {
    const data = {
      recordingInfo: { name: 'Props', startTime: 0, endTime: 1 },
      messages: [
        {
          topic: 't',
          payload: 'x',
          timestamp: 1,
          protocolVersion: 5,
          properties: { contentType: 'text/plain' },
        },
      ],
    };
    expect(parseRecording(data).messages[0]).toMatchObject({
      protocolVersion: 5,
      properties: { contentType: 'text/plain' },
    });
    for (const bad of [{ protocolVersion: 6 }, { properties: [] }, { properties: null }])
      expect(() =>
        parseRecording({ ...data, messages: [{ ...data.messages[0], ...bad }] }),
      ).toThrow('message');
  });
});

describe('simulation values', () => {
  it('honors zero precision, bounds, probability and empty strings', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    expect(
      generateValue({
        dataType: 'number',
        generator: 'static',
        decimalPrecision: 0,
        config: { value: 1.75 },
      }),
    ).toBe(2);
    expect(
      generateValue({ dataType: 'number', generator: 'uniform', config: { min: -10, max: 0 } }),
    ).toBe(-7.5);
    expect(
      generateValue({
        dataType: 'boolean',
        generator: 'probability',
        config: { trueProbability: 0 },
      }),
    ).toBe(false);
    expect(generateValue({ dataType: 'string', generator: 'static', config: { value: '' } })).toBe(
      '',
    );
  });
  it('never picks a zero-weight value', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(
      generateValue({
        dataType: 'enum',
        generator: 'weighted',
        config: {
          weightedValues: [
            { value: 'never', weight: 0 },
            { value: 'yes', weight: 1 },
          ],
        },
      }),
    ).toBe('yes');
  });
});

describe('import validation', () => {
  it('rejects malformed messages and recomputes imported counts', () => {
    const data = {
      recordingInfo: { name: 'Test', startTime: 0, endTime: 100, messageCount: 99 },
      messages: [{ topic: 'a', payload: '', timestamp: 1, qos: 0 }],
    };
    expect(parseRecording(data).messageCount).toBe(1);
    expect(parseRecording(data).messages[0].message).toBe('');
    expect(() =>
      parseRecording({ ...data, messages: [{ ...data.messages[0], timestamp: 'bad' }] }),
    ).toThrow('timestamp');
    expect(() => parseRecording({ ...data, messages: [null] })).toThrow('message');
  });

  it('validates nulls, arrays, nested values and required properties', () => {
    const validate = MessageTemplateService.prototype.validateAgainstSchema;
    const service = Object.create(MessageTemplateService.prototype);
    const schema = {
      type: 'object',
      required: ['missing'],
      properties: { items: { type: 'array', items: { type: 'integer' } } },
    };
    expect(validate.call(service, null, schema).valid).toBe(false);
    expect(validate.call(service, [], schema).valid).toBe(false);
    expect(validate.call(service, { items: [1] }, schema).errors).toContain(
      'Missing required property: missing',
    );
    expect(validate.call(service, { missing: true, items: [1, 2] }, schema).valid).toBe(true);
    expect(validate.call(service, { missing: true, items: ['bad'] }, schema).valid).toBe(false);
  });
});
