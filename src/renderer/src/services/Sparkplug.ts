import MQTTService from './MQTTService';
import { decoderRegistry } from './DecoderRegistry';
import type { PayloadEncoding } from '../../../shared/payload';
import {
  SPARKPLUG_DECODER,
  sparkplugTopic,
  type SparkplugOutgoingPayload,
  type SparkplugTopic,
} from '../../../shared/sparkplug';

/** A metric as main decodes it: keyed by name in `metrics`. */
export interface SparkplugMetricValue {
  value: unknown;
  type: string;
  alias?: number | string;
  timestamp?: number | string;
}

export interface DecodedSparkplug {
  timestamp?: number;
  seq?: number;
  metrics: Record<string, SparkplugMetricValue>;
}

export const REBIRTH_METRIC = 'Node Control/Rebirth';

export async function decodeSparkplug(
  message: string,
  encoding: PayloadEncoding,
  topic: string,
): Promise<DecodedSparkplug> {
  return JSON.parse(await decoderRegistry.decode(SPARKPLUG_DECODER, message, encoding, topic));
}

/** Encode in main, where protobuf code may run, then publish the bytes as base64. */
export async function publishSparkplug(
  connectionId: string,
  topic: string,
  payload: SparkplugOutgoingPayload,
  qos = 0,
): Promise<number> {
  const encoded = await window.electronAPI.sparkplug.encode(payload);
  if (!encoded.success || !encoded.data)
    throw new Error(encoded.error || 'The Sparkplug payload could not be encoded');
  await MQTTService.publish(connectionId, {
    topic,
    message: encoded.data.message,
    encoding: 'base64',
    qos,
    retain: false,
  });
  return encoded.data.byteLength;
}

/** Ask an edge node to publish its births again, which also names every aliased metric. */
export function requestRebirth(
  connectionId: string,
  { group, edgeNode }: Pick<SparkplugTopic, 'group' | 'edgeNode'>,
): Promise<number> {
  return publishSparkplug(connectionId, sparkplugTopic({ group, edgeNode, messageType: 'NCMD' }), {
    timestamp: Date.now(),
    metrics: [{ name: REBIRTH_METRIC, type: 'Boolean', value: true }],
  });
}
