import protobuf from 'protobufjs';
import { DECODER_LIMITS, decoderSources, type DecoderDefinition } from '../shared/decoders';

/**
 * Compile `.proto` sources into one root, so files can import each other. Google's well-known
 * types (google/protobuf/*.proto) are built in. Missing imports fail here, naming the type.
 */
export function compileProto(sources: string[]): protobuf.Root {
  const root = new protobuf.Root();
  const imports = new Set<string>();
  for (const source of sources)
    for (const name of protobuf.parse(source, root, { keepCase: true }).imports ?? [])
      imports.add(name);
  for (const name of imports) {
    // Built-in definitions, unless the user supplied their own copy of that file.
    const nested = protobuf.common.get(name)?.nested as any;
    const types = Object.keys(nested?.google?.nested?.protobuf?.nested ?? {});
    if (types.length && types.every((type) => !root.lookup(`google.protobuf.${type}`)))
      root.addJSON(nested);
  }
  try {
    root.resolveAll();
  } catch (error) {
    const declared = [...imports].filter((name) => !name.startsWith('google/protobuf/'));
    throw new Error(
      `${(error as Error).message}${declared.length ? `. Select the imported files too: ${declared.join(', ')}` : ''}`,
    );
  }
  return root;
}

/** Message types declared in `.proto` sources, fully qualified. */
export function protoTypes(sources: string[]): string[] {
  const root = compileProto(sources);
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
        types.set(
          decoder.id,
          compileProto(decoderSources(decoder)).lookupType(decoder.messageType),
        );
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
