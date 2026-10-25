import { expect, it } from 'vitest';
import { ConnectionNotices } from '../src/renderer/src/services/ConnectionNotices';

it('reports one error per message per outage and the reconnect that ends it', () => {
  const notices = new ConnectionNotices();
  expect(notices.error('a', 'refused')).toBe(true);
  expect(notices.error('a', 'refused')).toBe(true); // Not in an outage: always shown.
  expect(notices.connected('a')).toBe('connected');
  notices.reconnecting('a');
  notices.reconnecting('a');
  expect(notices.error('a', 'refused')).toBe(true);
  expect(notices.error('a', 'refused')).toBe(false);
  expect(notices.error('a', 'timeout')).toBe(true);
  expect(notices.error('b', 'refused')).toBe(true);
  expect(notices.connected('a')).toBe('reconnected');
  expect(notices.connected('a')).toBe('connected');
  notices.reconnecting('a');
  expect(notices.error('a', 'refused')).toBe(true);
});
