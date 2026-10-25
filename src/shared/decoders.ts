import { topicMatches, validTopicFilter } from './history-search';

/** A user-provided protobuf schema applied to topics matching an MQTT filter. */
export interface DecoderDefinition {
  id: string;
  name: string;
  topicFilter: string;
  /** Fully qualified message type, for example `demo.Reading`. */
  messageType: string;
  /** `.proto` source text. Imports are not resolved; put dependent types in one file. */
  proto: string;
}

export const DECODER_LIMITS = {
  maxDecoders: 32,
  maxProtoChars: 1024 * 1024,
  maxPayloadBytes: 1024 * 1024,
  maxOutputChars: 1024 * 1024,
};

export function validateDecoders(value: unknown): DecoderDefinition[] {
  if (!Array.isArray(value) || value.length > DECODER_LIMITS.maxDecoders)
    throw new Error(`Use at most ${DECODER_LIMITS.maxDecoders} decoders.`);
  const ids = new Set<string>();
  return value.map((item) => {
    const decoder = item as Partial<DecoderDefinition>;
    const text = (field: unknown, max: number) =>
      typeof field === 'string' && field.trim().length > 0 && field.length <= max;
    if (
      !decoder ||
      !text(decoder.id, 128) ||
      ids.has(decoder.id!) ||
      !text(decoder.name, 128) ||
      !text(decoder.messageType, 512) ||
      !text(decoder.proto, DECODER_LIMITS.maxProtoChars)
    )
      throw new Error('Each decoder needs a unique id, a name, a message type and .proto source.');
    if (!validTopicFilter(decoder.topicFilter))
      throw new Error(`${decoder.name}: enter an MQTT topic filter, for example sensors/+/data.`);
    ids.add(decoder.id!);
    return {
      id: decoder.id!,
      name: decoder.name!.trim(),
      topicFilter: decoder.topicFilter!,
      messageType: decoder.messageType!.trim(),
      proto: decoder.proto!,
    };
  });
}

/** The first decoder, in list order, whose filter matches the topic. */
export function matchDecoder<T extends Pick<DecoderDefinition, 'topicFilter'>>(
  decoders: T[],
  topic: string,
): T | undefined {
  return decoders.find((decoder) => topicMatches(decoder.topicFilter, topic));
}

export type DecoderRequest =
  | { action: 'configure'; decoders: DecoderDefinition[] }
  | { action: 'types'; proto: string }
  | {
      action: 'decode';
      decoderId: string;
      message: string;
      encoding: import('./payload').PayloadEncoding;
    }
  | { action: 'close' };
