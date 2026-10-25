import { serializeProperties } from './history';
import type { PayloadEncoding } from './payload';

export interface ExportableMessage {
  timestamp: number;
  message: string;
  encoding?: PayloadEncoding;
  qos: number;
  retain: boolean;
  connectionId?: string;
  protocolVersion?: number;
  properties?: Record<string, unknown>;
}

/** Export original payloads and normalized binary metadata, never display previews. */
export function exportRow(message: ExportableMessage) {
  const properties = serializeProperties(message.properties);
  return {
    timestamp: message.timestamp,
    payload: message.message,
    encoding: message.encoding ?? 'utf8',
    qos: message.qos,
    retain: message.retain,
    connectionId: message.connectionId,
    protocolVersion: message.protocolVersion,
    properties: properties ? JSON.parse(properties) : undefined,
  };
}

export const CSV_HEADER =
  'Timestamp,Payload,Encoding,QoS,Retain,Connection,ProtocolVersion,Properties';

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
export function csvRow(message: ExportableMessage): string {
  const row = exportRow(message);
  return [
    csvCell(row.timestamp),
    csvCell(row.payload),
    row.encoding,
    row.qos,
    row.retain,
    csvCell(row.connectionId),
    row.protocolVersion ?? '',
    csvCell(row.properties ? JSON.stringify(row.properties) : ''),
  ].join(',');
}
