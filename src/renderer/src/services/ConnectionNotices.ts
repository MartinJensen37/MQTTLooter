/**
 * Limits connection notifications to one per outage: automatic reconnect attempts repeat the
 * same error every reconnect period, which otherwise produces a burst of identical toasts.
 */
export class ConnectionNotices {
  private outages = new Map<string, Set<string>>();

  reconnecting(connectionId: string): void {
    if (!this.outages.has(connectionId)) this.outages.set(connectionId, new Set());
  }

  /** Whether to show this error. Errors outside an outage are always shown. */
  error(connectionId: string, message: string): boolean {
    const seen = this.outages.get(connectionId);
    if (!seen) return true;
    if (seen.has(message)) return false;
    seen.add(message);
    return true;
  }

  connected(connectionId: string): 'connected' | 'reconnected' {
    return this.outages.delete(connectionId) ? 'reconnected' : 'connected';
  }
}
