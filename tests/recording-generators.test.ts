import { afterEach, describe, expect, it, vi } from 'vitest';
import RecordingCapture from '../src/renderer/src/services/RecordingCapture';
import { generateValue } from '../src/renderer/src/utils/valueGenerators';
import { parseRecording } from '../src/renderer/src/components/RecordingPanel/recordingPanel/parseRecording';
import MessageTemplateService from '../src/renderer/src/services/MessageTemplateService';

afterEach(() => vi.restoreAllMocks());

describe('recording capture', () => {
  const message = {
    id: 'a',
    topic: 'topic',
    message: 'payload',
    timestamp: 100,
    qos: 1,
    retain: true,
  };
  it('captures every message for its broker independently of browsing history', () => {
    const capture = new RecordingCapture('a', 'Broker A');
    capture.add({ ...message, id: 'b' });
    for (let i = 0; i < 500; i++) capture.add(message);
    const recording = capture.finish()!;
    expect(recording.messageCount).toBe(500);
    expect(recording.messages[0]).toMatchObject({ connectionId: 'a', qos: 1, retain: true });
    expect(recording.connectionName).toBe('Broker A');
  });
  it('stops at count and byte limits without dropping captured data', () => {
    const capture = new RecordingCapture('a', 'A', 1);
    expect(capture.add(message)).toBe(true);
    expect(capture.add(message)).toBe(false);
    expect(capture.finish()?.messageCount).toBe(1);
    expect(new RecordingCapture('a', 'A', 10, 1).add(message)).toBe(false);
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
