import { useEffect, useState } from 'react';
import MQTTService from '../../services/MQTTService';
import type { TrafficStatus as Status } from '../../../../shared/traffic';

export default function TrafficStatus({ connectionId }: { connectionId: string }) {
  const [status, setStatus] = useState<Status>();
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await MQTTService.getTrafficStatus();
        if (!disposed) setStatus(next);
      } catch {
        if (!disposed) setStatus(undefined);
      } finally {
        if (!disposed) timer = setTimeout(refresh, 1000);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [connectionId]);
  const counts = status?.connections[connectionId];
  if (!status || !counts) return null;
  return (
    <>
      {counts.dropped > 0 && (
        <p className="history-limit-notice" role="status">
          Delivery gap: {counts.dropped.toLocaleString()} messages dropped or unconfirmed after
          reload. Browsing history and recordings may be incomplete.
        </p>
      )}
      <details className="topic-history-controls topic-traffic-status">
        <summary>Message delivery</summary>
        <p>
          {counts.received.toLocaleString()} received · {counts.processed.toLocaleString()}{' '}
          processed · {counts.dropped.toLocaleString()} dropped/unconfirmed
        </p>
        <p>
          Shared queue: {status.pendingMessages + status.inFlightMessages} / {status.maxMessages}{' '}
          messages · {((status.pendingBytes + status.inFlightBytes) / 1048576).toFixed(1)} /{' '}
          {(status.maxBytes / 1048576).toFixed(0)} MiB estimated.
        </p>
        <p>
          Counts cover this app run. Processed means delivered to the UI, not saved to disk. Old
          cached messages may expire separately.
        </p>
      </details>
    </>
  );
}
