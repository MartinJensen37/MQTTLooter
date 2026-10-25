import { NumericSampler, type NumericQuery } from '../shared/numeric-series';
import {
  SEARCH_LIMITS,
  validateSearch,
  type HistorySearchQuery,
  type HistorySearchPage,
} from '../shared/history-search';
import { DatabaseSync } from 'node:sqlite';
import {
  DISK_HISTORY,
  serializeProperties,
  type HistoryDrop,
  type HistoryPage,
  type HistoryMessage,
  type HistoryQuery,
} from '../shared/history';
import { encodePayload, payloadBytes } from '../shared/payload';
import type { IncomingPublish } from '../shared/traffic';

/** Synchronous SQLite is confined to the storage worker. */
export class HistoryDatabase {
  private db: DatabaseSync;
  private retainedMessages = 0;
  private retainedBytes = 0;
  private expired = 0;
  private generation = 0;

  constructor(
    path: string,
    private limits = DISK_HISTORY,
  ) {
    this.db = new DatabaseSync(path);
    // One worker owns reads and writes; rollback journaling avoids an unbounded WAL.
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=-8192;
      PRAGMA temp_store=FILE; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;`);
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if (version > 3) {
      this.db.close();
      throw new Error('History database uses a newer schema');
    }
    const pageSize = Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
    this.db.exec(`PRAGMA max_page_count=${Math.floor(limits.maxDatabaseBytes / pageSize)}`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS topics (
        id INTEGER PRIMARY KEY, connection_id TEXT NOT NULL, path TEXT NOT NULL,
        last_seen INTEGER NOT NULL, UNIQUE(connection_id, path)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id INTEGER NOT NULL REFERENCES topics(id),
        session_id TEXT NOT NULL, sequence INTEGER NOT NULL, timestamp INTEGER NOT NULL,
        qos INTEGER NOT NULL, retain INTEGER NOT NULL, protocol INTEGER NOT NULL,
        payload BLOB NOT NULL, properties TEXT, storage_bytes INTEGER NOT NULL,
        UNIQUE(session_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS topic_messages ON messages(topic_id, id);
      CREATE INDEX IF NOT EXISTS message_time ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS topic_message_time ON messages(topic_id, timestamp, id);
      CREATE TABLE IF NOT EXISTS gaps (
        id INTEGER PRIMARY KEY, connection_id TEXT NOT NULL, at INTEGER NOT NULL,
        dropped INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS connection_gaps ON gaps(connection_id, at);
      PRAGMA user_version=3;
    `);
    this.recount();
  }

  private recount(): void {
    const counts = this.db
      .prepare('SELECT count(*) count, coalesce(sum(storage_bytes),0) bytes FROM messages')
      .get()!;
    this.retainedMessages = Number(counts.count);
    this.retainedBytes = Number(counts.bytes);
  }

  append(messages: IncomingPublish[], now = Date.now(), drops: HistoryDrop[] = []): void {
    const topic = this.db.prepare(`INSERT INTO topics(connection_id, path, last_seen) VALUES(?,?,?)
      ON CONFLICT(connection_id,path) DO UPDATE SET last_seen=excluded.last_seen RETURNING id`);
    const insert = this.db.prepare(`INSERT OR IGNORE INTO messages
      (topic_id,session_id,sequence,timestamp,qos,retain,protocol,payload,properties,storage_bytes)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    let added = 0;
    let bytesAdded = 0;
    const removedTopics = new Set<number>();
    let removed = 0;
    let bytesRemoved = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const gap = this.db.prepare('INSERT INTO gaps(connection_id, at, dropped) VALUES(?,?,?)');
      for (const drop of drops) gap.run(drop.connectionId, drop.at, drop.dropped);
      this.db.prepare('DELETE FROM gaps WHERE at < ?').run(now - this.limits.maxAgeMs);
      for (const message of messages) {
        const payload = payloadBytes(message.message, message.encoding);
        const properties = serializeProperties(message.properties);
        const bytes =
          payload.byteLength + message.topic.length * 2 + (properties?.length ?? 0) * 2 + 256;
        const topicId = topic.get(message.id, message.topic, message.timestamp)!.id;
        const result = insert.run(
          topicId,
          message.sessionId,
          message.sequence,
          message.timestamp,
          message.qos,
          Number(message.retain),
          message.protocolVersion,
          payload,
          properties,
          bytes,
        );
        if (result.changes) {
          added++;
          bytesAdded += bytes;
        }
      }
      const remove = (
        rows: { id: number; storage_bytes: number; topic_id: number }[],
        toBudget = false,
      ) => {
        const statement = this.db.prepare('DELETE FROM messages WHERE id=?');
        for (const row of rows) {
          if (
            toBudget &&
            this.retainedBytes + bytesAdded - bytesRemoved <= this.limits.maxPayloadBytes
          )
            break;
          statement.run(row.id);
          removedTopics.add(row.topic_id);
          removed++;
          bytesRemoved += row.storage_bytes;
        }
      };
      // Expire old history in bounded chunks on each transaction.
      remove(
        this.db
          .prepare(
            'SELECT id, storage_bytes, topic_id FROM messages WHERE timestamp < ? ORDER BY timestamp LIMIT 300',
          )
          .all(now - this.limits.maxAgeMs) as {
          id: number;
          storage_bytes: number;
          topic_id: number;
        }[],
      );
      while (this.retainedBytes + bytesAdded - bytesRemoved > this.limits.maxPayloadBytes) {
        const rows = this.db
          .prepare('SELECT id, storage_bytes, topic_id FROM messages ORDER BY id LIMIT 300')
          .all() as { id: number; storage_bytes: number; topic_id: number }[];
        if (!rows.length) break;
        remove(rows, true);
      }
      // Catalog entries without retained messages are expendable. No unbounded empty catalog.
      const pruneTopic = this.db.prepare(
        'DELETE FROM topics WHERE id=? AND NOT EXISTS(SELECT 1 FROM messages WHERE topic_id=?)',
      );
      for (const topicId of removedTopics) pruneTopic.run(topicId, topicId);
      this.db.exec('COMMIT');
      this.retainedMessages += added - removed;
      this.retainedBytes += bytesAdded - bytesRemoved;
      this.expired += removed;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* SQLITE_FULL may roll back automatically. */
      }
      throw error;
    }
  }

  page(query: HistoryQuery, now = Date.now()): HistoryPage {
    if (query.generation !== undefined && query.generation !== this.generation)
      throw new Error('History was cleared. Refresh this view.');
    const snapshot =
      query.snapshot ??
      Number(this.db.prepare('SELECT coalesce(max(id),0) id FROM messages').get()!.id);
    const rows = this.db
      .prepare(
        `SELECT m.*, t.path, t.connection_id FROM messages m
      JOIN topics t ON t.id=m.topic_id WHERE t.connection_id=? AND t.path=?
      AND m.id<=? AND m.id<? AND m.timestamp>=? ORDER BY m.id DESC LIMIT ?`,
      )
      .iterate(
        query.connectionId,
        query.topic,
        snapshot,
        query.before ?? Number.MAX_SAFE_INTEGER,
        now - this.limits.maxAgeMs,
        this.limits.pageMessages + 1,
      );
    const result: HistoryPage = {
      messages: [],
      snapshot,
      generation: this.generation,
      nextBefore: null,
      expired: this.expired,
    };
    let bytes = 0;
    for (const row of rows) {
      if (
        result.messages.length &&
        (result.messages.length >= this.limits.pageMessages ||
          bytes + Number(row.storage_bytes) > this.limits.pageBytes)
      ) {
        result.nextBefore = result.messages.at(-1)!.rowId;
        break;
      }
      bytes += Number(row.storage_bytes);
      result.messages.push(this.decodeMessage(row));
    }
    return result;
  }

  private decodeMessage(row: Record<string, unknown>): HistoryMessage {
    return {
      rowId: Number(row.id),
      id: String(row.connection_id),
      topic: String(row.path),
      sessionId: String(row.session_id),
      sequence: Number(row.sequence),
      timestamp: Number(row.timestamp),
      qos: Number(row.qos),
      retain: Boolean(row.retain),
      protocolVersion: Number(row.protocol),
      ...encodePayload(row.payload as Uint8Array),
      properties: row.properties ? JSON.parse(String(row.properties)) : undefined,
    };
  }

  series(query: NumericQuery) {
    const sampler = new NumericSampler(query);
    const rows = this.db
      .prepare(
        `SELECT m.id, m.timestamp, m.session_id,
      CASE WHEN length(m.payload)<=65536 THEN m.payload ELSE NULL END payload
      FROM messages m JOIN topics t ON t.id=m.topic_id
      WHERE t.connection_id=? AND t.path=? AND m.timestamp>=? AND m.timestamp<=?
      ORDER BY m.timestamp DESC, m.id DESC LIMIT 20001`,
      )
      .iterate(
        query.connectionId,
        query.topic,
        Math.max(query.from, Date.now() - this.limits.maxAgeMs),
        query.to,
      );
    const started = performance.now();
    let scanned = 0;
    let bytes = 0;
    let truncated = false;
    for (const row of rows) {
      const payload = row.payload as Uint8Array | null;
      if (
        ++scanned > 20000 ||
        (bytes += payload?.byteLength ?? 0) > 8 * 1024 * 1024 ||
        performance.now() - started > 75
      ) {
        truncated = true;
        break;
      }
      sampler.add(Number(row.timestamp), Number(row.id), String(row.session_id), payload);
    }
    return sampler.result(truncated);
  }

  /** One resumable slice. Time filtering happens here so SQL cannot scan an unbounded time-filtered tail. */
  search(query: HistorySearchQuery, now = Date.now()): HistorySearchPage {
    validateSearch(query);
    if (query.generation !== undefined && query.generation !== this.generation)
      throw new Error('History was cleared. Start a new search.');
    const snapshot =
      query.snapshot ??
      Number(this.db.prepare('SELECT coalesce(max(id),0) id FROM messages').get()!.id);
    const result: HistorySearchPage = {
      messages: [],
      snapshot,
      generation: this.generation,
      nextBefore: null,
      expired: this.expired,
      scanned: 0,
      skippedLarge: 0,
      skippedBinary: 0,
    };
    const rows = this.db
      .prepare(
        `SELECT m.id, m.timestamp, m.storage_bytes,
      CASE WHEN length(m.payload)<=? AND m.storage_bytes<=? THEN m.payload ELSE NULL END payload
      FROM messages m JOIN topics t ON t.id=m.topic_id
      WHERE t.connection_id=? AND t.path=? AND m.id<=? AND m.id<? ORDER BY m.id DESC LIMIT ?`,
      )
      .iterate(
        SEARCH_LIMITS.payloadBytes,
        SEARCH_LIMITS.resultBytes,
        query.connectionId,
        query.topic,
        snapshot,
        query.before ?? Number.MAX_SAFE_INTEGER,
        SEARCH_LIMITS.rows + 1,
      );
    const getMatch = this.db.prepare(
      'SELECT m.*, t.path, t.connection_id FROM messages m JOIN topics t ON t.id=m.topic_id WHERE m.id=?',
    );
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const needle = query.mode === 'hex' ? Buffer.from(query.term.replace(/\s/g, ''), 'hex') : null;
    const started = performance.now();
    let scannedBytes = 0;
    let resultBytes = 0;
    let lastRow = 0;
    for (const row of rows) {
      const payload = row.payload as Uint8Array | null;
      if (
        result.scanned &&
        (result.scanned >= SEARCH_LIMITS.rows ||
          scannedBytes + (payload?.byteLength ?? 0) > SEARCH_LIMITS.scanBytes ||
          performance.now() - started >= SEARCH_LIMITS.workMs ||
          result.messages.length >= SEARCH_LIMITS.matches)
      ) {
        result.nextBefore = lastRow;
        break;
      }
      const inRange =
        Number(row.timestamp) >= Math.max(query.from, now - this.limits.maxAgeMs) &&
        Number(row.timestamp) <= query.to;
      let matches = false;
      let binary = false;
      if (inRange && payload) {
        if (needle)
          matches = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).includes(
            needle,
          );
        else {
          try {
            matches = decoder.decode(payload).includes(query.term);
          } catch {
            binary = true;
          }
        }
      }
      if (matches && resultBytes + Number(row.storage_bytes) > SEARCH_LIMITS.resultBytes) {
        result.nextBefore = lastRow;
        break;
      }
      result.scanned++;
      scannedBytes += payload?.byteLength ?? 0;
      lastRow = Number(row.id);
      if (inRange && payload === null) result.skippedLarge++;
      if (binary) result.skippedBinary++;
      if (!matches) continue;
      resultBytes += Number(row.storage_bytes);
      const match = getMatch.get(row.id)!;
      result.messages.push(this.decodeMessage(match));
    }
    return result;
  }

  topics(connectionId: string, search: string): { path: string }[] {
    return this.db
      .prepare(
        `SELECT path FROM topics WHERE connection_id=? AND instr(path,?)>0 ORDER BY path LIMIT 50`,
      )
      .all(connectionId, search) as { path: string }[];
  }

  clear(connectionId: string, topic?: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const condition = topic === undefined ? 'connection_id=?' : 'connection_id=? AND path=?';
      const parameters = topic === undefined ? [connectionId] : [connectionId, topic];
      this.db
        .prepare(
          `DELETE FROM messages WHERE topic_id IN (SELECT id FROM topics WHERE ${condition})`,
        )
        .run(...parameters);
      this.db.prepare(`DELETE FROM topics WHERE ${condition}`).run(...parameters);
      if (topic === undefined)
        this.db.prepare('DELETE FROM gaps WHERE connection_id=?').run(connectionId);
      this.db.exec('COMMIT');
      this.generation++;
      this.recount();
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* SQLITE_FULL may roll back automatically. */
      }
      throw error;
    }
  }

  status(now = Date.now()) {
    const pageSize = Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
    const pageCount = Number(this.db.prepare('PRAGMA page_count').get()!.page_count);
    const gaps: Record<string, { dropped: number; last: number }> = {};
    for (const row of this.db
      .prepare(
        `SELECT connection_id, sum(dropped) dropped, max(at) last FROM gaps WHERE at >= ?
      GROUP BY connection_id LIMIT 1000`,
      )
      .all(now - this.limits.maxAgeMs))
      gaps[String(row.connection_id)] = { dropped: Number(row.dropped), last: Number(row.last) };
    return {
      gaps,
      retainedMessages: this.retainedMessages,
      retainedBytes: this.retainedBytes,
      databaseBytes: pageSize * pageCount,
      expired: this.expired,
      generation: this.generation,
      limits: this.limits,
    };
  }

  close(): void {
    this.db.close();
  }
}
