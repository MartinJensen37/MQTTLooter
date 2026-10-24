import { serializeProperties } from '../../../shared/history';
import type { DisplayMessage } from '../services/TopicTreeService';

/** Export original payloads and normalized binary metadata, never display previews. */
export function exportMessage(message: DisplayMessage) {
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

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
export function exportMessageCSV(messages: DisplayMessage[]): string {
  return [
    'Timestamp,Payload,Encoding,QoS,Retain,Connection,ProtocolVersion,Properties',
    ...messages.map((message) => {
      const row = exportMessage(message);
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
    }),
  ].join('\n');
}
