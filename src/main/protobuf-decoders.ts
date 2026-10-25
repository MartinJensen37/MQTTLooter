import protobuf from 'protobufjs';
import { DECODER_LIMITS, type DecoderDefinition } from '../shared/decoders';

/** Message types declared in a `.proto` source, fully qualified. */
export function protoTypes(proto: string): string[] {
  const { root } = protobuf.parse(proto, { keepCase: true });
  const types: string[] = [];
  const walk = (namespace: protobuf.NamespaceBase) => {
    for (const nested of namespace.nestedArray) {
      if (nested instanceof protobuf.Type) types.push(nested.fullName.replace(/^\./, ''));
      if (nested instanceof protobuf.Namespace) walk(nested);
    }
  };
  walk(root);
  return types.slice(0, 1000);
}

/**
 * Compiled decoders. Generated protobuf code needs `new Function`, which the renderer's CSP
 * forbids, so this runs in a main-process worker; decoding never changes stored bytes.
 */
export class ProtobufDecoders {
  private types = new Map<string, protobuf.Type>();

  /** Compile every definition; returns an error per decoder that failed. */
  configure(decoders: DecoderDefinition[]): Record<string, string> {
    const errors: Record<string, string> = {};
    const types = new Map<string, protobuf.Type>();
    for (const decoder of decoders) {
      try {
        const { root } = protobuf.parse(decoder.proto, { keepCase: true });
        types.set(decoder.id, root.lookupType(decoder.messageType));
      } catch (error) {
        errors[decoder.id] = `${decoder.name}: ${(error as Error).message}`;
      }
    }
    this.types = types;
    return errors;
  }

  /**
   * A decoded object for plotting: 64-bit integers become numbers and zero-valued fields are
   * included, because proto3 omits them from the wire and a missing value would plot as a gap.
   * Returns undefined for payloads that do not decode.
   */
  decodeValues(decoderId: string, payload: Uint8Array): unknown {
    const type = this.types.get(decoderId);
    if (!type || payload.byteLength > DECODER_LIMITS.maxPayloadBytes) return undefined;
    try {
      return type.toObject(type.decode(payload), {
        longs: Number,
        enums: String,
        bytes: String,
        defaults: true,
      });
    } catch {
      return undefined;
    }
  }

  /** Decoded JSON text, with 64-bit integers as strings, bytes as base64 and enum names. */
  decode(decoderId: string, payload: Uint8Array): string {
    const type = this.types.get(decoderId);
    if (!type) throw new Error('This decoder is not available. Check its schema.');
    if (payload.byteLength > DECODER_LIMITS.maxPayloadBytes)
      throw new Error('Payload is too large to decode (1 MiB limit).');
    let message: protobuf.Message;
    try {
      message = type.decode(payload);
    } catch (error) {
      throw new Error(
        `Payload does not match ${type.fullName.replace(/^\./, '')}: ${(error as Error).message}`,
      );
    }
    const text = JSON.stringify(
      type.toObject(message, { longs: String, enums: String, bytes: String, defaults: false }),
      null,
      2,
    );
    if (text.length > DECODER_LIMITS.maxOutputChars)
      throw new Error('Decoded output exceeds 1 MiB.');
    return text;
  }
}
