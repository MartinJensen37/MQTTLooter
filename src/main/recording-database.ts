import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { serializeProperties } from '../shared/history';
import { encodePayload, payloadBytes } from '../shared/payload';
import {
  parseRecording,
  RECORDING_LIMITS,
  type Recording,
  type RecordingGap,
  type RecordingPage,
  type RecordingPageQuery,
  type RecordingSummary,
  type StoredRecordingMessage,
} from '../shared/recording';
import type { IncomingPublish } from '../shared/traffic';

export type CaptureMessage = IncomingPublish & { recordingId: number };
type Row = Record<string, unknown>;

export const STORAGE_FULL = 'Recording storage limit reached. Export or delete older recordings.';
export const INTERRUPTED = 'The app closed while recording. Messages saved before then were kept.';

/** Synchronous SQLite is confined to the recording worker. Every batch is one transaction. */
export class RecordingDatabase {
  private db: DatabaseSync;
  /** Active captures: next sequence number and running counts. */
  private active = new Map<number, { seq: number; messages: number; topics: number }>();
  readonly recovered: number;

  constructor(
    path: string,
    private limits = RECORDING_LIMITS,
  ) {
    this.db = new DatabaseSync(path);
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if (version > 1) {
      this.db.close();
      throw new Error('Recording database uses a newer schema');
    }
    // auto_vacuum applies only before the first table exists. WAL keeps per-batch commits cheap;
    // a single connection lets automatic checkpoints complete, and the size limit caps the file.
    this.db
      .exec(`PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      PRAGMA journal_size_limit=67108864; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;`);
    const pageSize = Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
    this.db.exec(`PRAGMA max_page_count=${Math.floor(limits.maxDatabaseBytes / pageSize)}`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS recordings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        connection_id TEXT, connection_name TEXT NOT NULL, state TEXT NOT NULL,
        started_at INTEGER NOT NULL, ended_at INTEGER,
        message_count INTEGER NOT NULL DEFAULT 0, payload_bytes INTEGER NOT NULL DEFAULT 0,
        topic_count INTEGER NOT NULL DEFAULT 0, last_seq INTEGER NOT NULL DEFAULT 0,
        incomplete_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS recording_topics (
        recording_id INTEGER NOT NULL, topic TEXT NOT NULL, messages INTEGER NOT NULL,
        PRIMARY KEY(recording_id, topic)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS recording_messages (
        recording_id INTEGER NOT NULL, seq INTEGER NOT NULL, timestamp INTEGER NOT NULL,
        topic TEXT NOT NULL, payload BLOB NOT NULL, qos INTEGER NOT NULL, retain INTEGER NOT NULL,
        protocol INTEGER, session_id TEXT, properties TEXT,
        PRIMARY KEY(recording_id, seq)
      );
      CREATE INDEX IF NOT EXISTS recording_topic_seq ON recording_messages(recording_id, topic, seq);
      CREATE TABLE IF NOT EXISTS recording_gaps (
        id INTEGER PRIMARY KEY, recording_id INTEGER NOT NULL, at INTEGER NOT NULL,
        until INTEGER, kind TEXT NOT NULL, dropped INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS recording_gap_order ON recording_gaps(recording_id, at);
      CREATE TABLE IF NOT EXISTS purge (recording_id INTEGER PRIMARY KEY);
      PRAGMA user_version=1;
    `);
    this.recovered = this.recover();
  }

  /** Captures left active by a crash end at their last committed message. */
  private recover(): number {
    return Number(
      this.db
        .prepare(
          `UPDATE recordings SET state='interrupted',
        ended_at=coalesce((SELECT timestamp FROM recording_messages m
          WHERE m.recording_id=recordings.id ORDER BY seq DESC LIMIT 1), started_at),
        incomplete_reason=coalesce(incomplete_reason, ?) WHERE state='active'`,
        )
        .run(INTERRUPTED).changes,
    );
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* SQLITE_FULL may roll back automatically. */
      }
      throw error;
    }
  }

  usedBytes(): number {
    const pragma = (name: string) =>
      Number(Object.values(this.db.prepare(`PRAGMA ${name}`).get()!)[0]);
    return (pragma('page_count') - pragma('freelist_count')) * pragma('page_size');
  }

  create(connectionId: string, connectionName: string, name: string, at: number): RecordingSummary {
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO recordings(name, connection_id, connection_name, state, started_at)
        VALUES(?,?,?,'active',?) RETURNING id`,
        )
        .get(name.slice(0, this.limits.maxNameLength), connectionId, connectionName, at)!.id,
    );
    this.active.set(id, { seq: 0, messages: 0, topics: 0 });
    return this.summary(id)!;
  }

  isActive(recordingId: number): boolean {
    return this.active.has(recordingId);
  }

  /** Insert one batch. Over quota, affected captures stop with a storage gap instead. */
  append(
    messages: CaptureMessage[],
    drops: { recordingId: number; at: number; dropped: number }[] = [],
    now = Date.now(),
  ): {
    counts: { recordingId: number; messageCount: number; topicCount: number }[];
    stopped: { recordingId: number; reason: string }[];
  } {
    const stopped: { recordingId: number; reason: string }[] = [];
    const incoming = messages.reduce(
      (sum, message) => sum + message.message.length + message.topic.length * 2 + 128,
      0,
    );
    if (messages.length && this.usedBytes() + incoming > this.limits.maxDatabaseBytes) {
      const affected = new Map<number, number>();
      for (const message of messages)
        if (this.active.has(message.recordingId))
          affected.set(message.recordingId, (affected.get(message.recordingId) ?? 0) + 1);
      this.transaction(() => {
        for (const [recordingId, dropped] of affected) {
          this.insertGap(recordingId, now, 'storage', dropped);
          this.finishRow(recordingId, now, STORAGE_FULL);
        }
      });
      for (const recordingId of affected.keys()) {
        this.active.delete(recordingId);
        stopped.push({ recordingId, reason: STORAGE_FULL });
      }
      return { counts: this.counts(), stopped };
    }
    const insert = this.db.prepare(`INSERT INTO recording_messages
      (recording_id, seq, timestamp, topic, payload, qos, retain, protocol, session_id, properties)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    const topic = this.db.prepare(`INSERT INTO recording_topics VALUES(?,?,?)
      ON CONFLICT DO UPDATE SET messages=messages+excluded.messages RETURNING messages`);
    const update = this.db.prepare(`UPDATE recordings SET message_count=message_count+?,
      payload_bytes=payload_bytes+?, topic_count=topic_count+?, last_seq=? WHERE id=?`);
    const changes = new Map<
      number,
      { seq: number; messages: number; bytes: number; added: number; topics: Map<string, number> }
    >();
    this.transaction(() => {
      for (const drop of drops)
        if (this.active.has(drop.recordingId))
          this.insertGap(drop.recordingId, drop.at, 'queue', drop.dropped);
      for (const message of messages) {
        const state = this.active.get(message.recordingId);
        if (!state) continue;
        let change = changes.get(message.recordingId);
        if (!change) {
          change = { seq: state.seq, messages: 0, bytes: 0, added: 0, topics: new Map() };
          changes.set(message.recordingId, change);
        }
        const payload = payloadBytes(message.message, message.encoding);
        insert.run(
          message.recordingId,
          ++change.seq,
          message.timestamp,
          message.topic,
          payload,
          message.qos,
          Number(message.retain),
          message.protocolVersion,
          message.sessionId,
          serializeProperties(message.properties),
        );
        change.messages++;
        change.bytes += payload.byteLength;
        change.topics.set(message.topic, (change.topics.get(message.topic) ?? 0) + 1);
      }
      for (const [recordingId, change] of changes) {
        for (const [path, count] of change.topics)
          if (Number(topic.get(recordingId, path, count)!.messages) === count) change.added++;
        update.run(change.messages, change.bytes, change.added, change.seq, recordingId);
      }
    });
    // Advance in-memory state only after the commit succeeds.
    for (const [recordingId, change] of changes) {
      const state = this.active.get(recordingId)!;
      state.seq = change.seq;
      state.messages += change.messages;
      state.topics += change.added;
    }
    return { counts: this.counts(), stopped };
  }

  private counts() {
    return [...this.active].map(([recordingId, state]) => ({
      recordingId,
      messageCount: state.messages,
      topicCount: state.topics,
    }));
  }

  private insertGap(recordingId: number, at: number, kind: RecordingGap['kind'], dropped = 0) {
    this.db
      .prepare('INSERT INTO recording_gaps(recording_id, at, kind, dropped) VALUES(?,?,?,?)')
      .run(recordingId, at, kind, dropped);
  }

  private finishRow(recordingId: number, at: number, reason?: string) {
    this.db
      .prepare(
        `UPDATE recordings SET state='complete', ended_at=?,
      incomplete_reason=coalesce(?, incomplete_reason) WHERE id=? AND state='active'`,
      )
      .run(at, reason ?? null, recordingId);
    this.db
      .prepare(
        `UPDATE recording_gaps SET until=? WHERE recording_id=? AND kind='connection' AND until IS NULL`,
      )
      .run(at, recordingId);
  }

  finish(recordingId: number, at: number, reason?: string): RecordingSummary | null {
    if (!this.active.has(recordingId)) return this.summary(recordingId);
    this.transaction(() => this.finishRow(recordingId, at, reason));
    this.active.delete(recordingId);
    return this.summary(recordingId);
  }

  gap(recordingId: number, at: number, kind: RecordingGap['kind'], dropped = 0): void {
    if (!this.active.has(recordingId)) return;
    // One open connection gap per outage, however many reconnect attempts fail.
    if (
      kind === 'connection' &&
      this.db
        .prepare(
          `SELECT 1 FROM recording_gaps WHERE recording_id=? AND kind='connection' AND until IS NULL`,
        )
        .get(recordingId)
    )
      return;
    this.insertGap(recordingId, at, kind, dropped);
  }

  resolveGaps(recordingId: number, at: number): void {
    this.db
      .prepare(
        `UPDATE recording_gaps SET until=? WHERE recording_id=? AND kind='connection' AND until IS NULL`,
      )
      .run(at, recordingId);
  }

  private static readonly SUMMARY = `SELECT r.*,
    (SELECT min(topic) FROM recording_topics t WHERE t.recording_id=r.id) first_topic,
    (SELECT coalesce(sum(dropped),0) FROM recording_gaps g WHERE g.recording_id=r.id) dropped,
    (SELECT count(*) FROM recording_gaps g WHERE g.recording_id=r.id AND g.kind='connection') outages
    FROM recordings r`;

  private toSummary(row: Row): RecordingSummary {
    const topicCount = Number(row.topic_count);
    return {
      id: Number(row.id),
      name: String(row.name),
      connectionId: row.connection_id === null ? null : String(row.connection_id),
      connectionName: String(row.connection_name),
      state: row.state as RecordingSummary['state'],
      startTime: Number(row.started_at),
      endTime: row.ended_at === null ? null : Number(row.ended_at),
      messageCount: Number(row.message_count),
      payloadBytes: Number(row.payload_bytes),
      topicCount,
      topic: topicCount === 1 ? String(row.first_topic) : `${topicCount} Topics`,
      dropped: Number(row.dropped),
      outages: Number(row.outages),
      ...(row.incomplete_reason !== null && { incompleteReason: String(row.incomplete_reason) }),
    };
  }

  summary(recordingId: number): RecordingSummary | null {
    const row = this.db.prepare(`${RecordingDatabase.SUMMARY} WHERE r.id=?`).get(recordingId);
    return row ? this.toSummary(row) : null;
  }

  list(): RecordingSummary[] {
    return this.db
      .prepare(`${RecordingDatabase.SUMMARY} ORDER BY r.started_at DESC, r.id DESC LIMIT 10000`)
      .all()
      .map((row) => this.toSummary(row));
  }

  gaps(recordingId: number): RecordingGap[] {
    return this.db
      .prepare(
        'SELECT at, until, kind, dropped FROM recording_gaps WHERE recording_id=? ORDER BY at LIMIT 10000',
      )
      .all(recordingId)
      .map((row) => ({
        at: Number(row.at),
        until: row.until === null ? null : Number(row.until),
        kind: row.kind as RecordingGap['kind'],
        dropped: Number(row.dropped),
      }));
  }

  topics(recordingId: number): { topics: { topic: string; messages: number }[]; total: number } {
    const topics = this.db
      .prepare(
        'SELECT topic, messages FROM recording_topics WHERE recording_id=? ORDER BY topic LIMIT ?',
      )
      .all(recordingId, this.limits.maxTopicsListed)
      .map((row) => ({ topic: String(row.topic), messages: Number(row.messages) }));
    const total = this.db
      .prepare('SELECT topic_count FROM recordings WHERE id=?')
      .get(recordingId)?.topic_count;
    return { topics, total: Number(total ?? 0) };
  }

  count(recordingId: number, topics?: string[]): number {
    if (!topics)
      return Number(
        this.db.prepare('SELECT message_count FROM recordings WHERE id=?').get(recordingId)
          ?.message_count ?? 0,
      );
    return Number(
      this.db
        .prepare(
          `SELECT coalesce(sum(messages),0) total FROM recording_topics
        WHERE recording_id=? AND topic IN (SELECT value FROM json_each(?))`,
        )
        .get(recordingId, JSON.stringify(topics))!.total,
    );
  }

  private decode(row: Row, connectionId: string | null): StoredRecordingMessage {
    return {
      seq: Number(row.seq),
      topic: String(row.topic),
      ...encodePayload(row.payload as Uint8Array),
      timestamp: Number(row.timestamp),
      qos: Number(row.qos),
      retain: Boolean(row.retain),
      ...(connectionId !== null && { connectionId }),
      ...(row.protocol !== null && { protocolVersion: Number(row.protocol) }),
      ...(row.properties !== null && { properties: JSON.parse(String(row.properties)) }),
    };
  }

  /**
   * One page in capture order, returned ascending. A few filter topics use their index ranges;
   * larger filters scan a bounded number of rows and may return a partial page with a cursor.
   */
  page(query: RecordingPageQuery): RecordingPage {
    const limit = Math.max(1, Math.min(query.limit, this.limits.maxPageMessages));
    const forward = query.before === undefined;
    const bound = forward ? (query.after ?? 0) : query.before!;
    const comparison = forward ? '>' : '<';
    const order = forward ? 'ASC' : 'DESC';
    const owner = this.db
      .prepare('SELECT connection_id FROM recordings WHERE id=?')
      .get(query.recordingId);
    if (!owner) throw new Error('Recording not found');
    const connectionId = owner.connection_id === null ? null : String(owner.connection_id);
    let rows: Row[];
    let exhausted: boolean;
    let scannedThrough: number | null = null;
    if (query.topics && query.topics.length <= 16) {
      const statement = this.db.prepare(`SELECT * FROM recording_messages
        WHERE recording_id=? AND topic=? AND seq ${comparison} ? ORDER BY seq ${order} LIMIT ?`);
      const results = query.topics.map((topic) =>
        statement.all(query.recordingId, topic, bound, limit),
      );
      rows = results.flat();
      rows.sort((a, b) => (Number(a.seq) - Number(b.seq)) * (forward ? 1 : -1));
      // A topic that filled its page may have more rows beyond this page's edge.
      exhausted = rows.length <= limit && results.every((result) => result.length < limit);
      rows = rows.slice(0, limit);
    } else {
      const filter = query.topics ? new Set(query.topics) : null;
      rows = [];
      exhausted = true;
      let scanned = 0;
      for (const row of this.db
        .prepare(
          `SELECT * FROM recording_messages WHERE recording_id=? AND seq ${comparison} ?
          ORDER BY seq ${order} LIMIT ?`,
        )
        .iterate(query.recordingId, bound, this.limits.scanRows + 1)) {
        if (rows.length >= limit || scanned >= this.limits.scanRows) {
          exhausted = false;
          break;
        }
        scanned++;
        scannedThrough = Number(row.seq);
        if (!filter || filter.has(String(row.topic))) rows.push(row);
      }
    }
    const messages: StoredRecordingMessage[] = [];
    let bytes = 0;
    for (const row of rows) {
      const size = (row.payload as Uint8Array).byteLength;
      if (messages.length && bytes + size > this.limits.pageBytes) {
        exhausted = false;
        scannedThrough = null;
        break;
      }
      bytes += size;
      messages.push(this.decode(row, connectionId));
    }
    if (!forward) messages.reverse();
    const edge = forward ? messages.at(-1)?.seq : messages[0]?.seq;
    // A partial scan continues after the last row examined, even when it did not match.
    const cursor = exhausted ? null : (scannedThrough ?? edge ?? null);
    return { messages, cursor };
  }

  rename(recordingId: number, name: string): RecordingSummary {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > this.limits.maxNameLength)
      throw new Error('Recording names must contain 1-256 characters');
    this.db.prepare('UPDATE recordings SET name=? WHERE id=?').run(trimmed, recordingId);
    const summary = this.summary(recordingId);
    if (!summary) throw new Error('Recording not found');
    return summary;
  }

  /** Metadata disappears immediately; messages are purged in bounded steps. */
  delete(recordingId: number): void {
    if (this.active.has(recordingId)) throw new Error('Stop the recording before deleting it');
    this.transaction(() => {
      this.db.prepare('DELETE FROM recordings WHERE id=?').run(recordingId);
      this.db.prepare('DELETE FROM recording_topics WHERE recording_id=?').run(recordingId);
      this.db.prepare('DELETE FROM recording_gaps WHERE recording_id=?').run(recordingId);
      this.db.prepare('INSERT OR IGNORE INTO purge VALUES(?)').run(recordingId);
    });
  }

  /** Returns true while purge or vacuum work remains. */
  purgeStep(rows = 5000): boolean {
    const next = this.db.prepare('SELECT recording_id FROM purge LIMIT 1').get();
    if (next) {
      const removed = this.db
        .prepare(
          `DELETE FROM recording_messages WHERE rowid IN
        (SELECT rowid FROM recording_messages WHERE recording_id=? LIMIT ?)`,
        )
        .run(next.recording_id, rows).changes;
      if (!removed)
        this.db.prepare('DELETE FROM purge WHERE recording_id=?').run(next.recording_id);
      return true;
    }
    if (Number(this.db.prepare('PRAGMA freelist_count').get()!.freelist_count) > 0) {
      this.db.exec('PRAGMA incremental_vacuum(4096)');
      return Number(this.db.prepare('PRAGMA freelist_count').get()!.freelist_count) > 0;
    }
    return false;
  }

  /** Store a parsed recording in capture order. Timestamps sort stably. */
  private insertRecording(recording: Recording): number {
    const messages = recording.messages
      .map((message, index) => ({ message, index, time: new Date(message.timestamp).getTime() }))
      .sort((a, b) => a.time - b.time || a.index - b.index);
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO recordings(name, connection_id, connection_name, state, started_at, ended_at,
        incomplete_reason) VALUES(?,NULL,?,'complete',?,?,?) RETURNING id`,
        )
        .get(
          recording.name.slice(0, this.limits.maxNameLength),
          recording.connectionName,
          recording.startTime.getTime(),
          recording.endTime.getTime(),
          recording.incompleteReason ?? null,
        )!.id,
    );
    const insert = this.db.prepare(`INSERT INTO recording_messages
      (recording_id, seq, timestamp, topic, payload, qos, retain, protocol, session_id, properties)
      VALUES(?,?,?,?,?,?,?,?,NULL,?)`);
    const topics = new Map<string, number>();
    let bytes = 0;
    messages.forEach(({ message, time }, index) => {
      const payload = payloadBytes(message.message, message.encoding ?? 'utf8');
      bytes += payload.byteLength;
      topics.set(message.topic, (topics.get(message.topic) ?? 0) + 1);
      insert.run(
        id,
        index + 1,
        time,
        message.topic,
        payload,
        message.qos ?? 0,
        Number(message.retain ?? false),
        message.protocolVersion ?? null,
        serializeProperties(message.properties),
      );
    });
    const topic = this.db.prepare('INSERT INTO recording_topics VALUES(?,?,?)');
    for (const [path, count] of topics) topic.run(id, path, count);
    this.db
      .prepare(
        `UPDATE recordings SET message_count=?, payload_bytes=?, topic_count=?, last_seq=? WHERE id=?`,
      )
      .run(messages.length, bytes, topics.size, messages.length, id);
    return id;
  }

  private checkQuota(recordings: Recording[]): void {
    const estimate = recordings.reduce(
      (sum, recording) =>
        sum +
        recording.messages.reduce(
          (total, message) => total + message.message.length + message.topic.length * 2 + 128,
          0,
        ),
      0,
    );
    if (this.usedBytes() + estimate > this.limits.maxDatabaseBytes) throw new Error(STORAGE_FULL);
  }

  import(data: unknown): RecordingSummary {
    const recording = parseRecording(data);
    this.checkQuota([recording]);
    return this.summary(this.transaction(() => this.insertRecording(recording)))!;
  }

  /**
   * Import a legacy library once. The fingerprint and every recording commit together, so a
   * failed or repeated migration never duplicates or partially imports recordings.
   */
  importLibrary(recordings: unknown[], source: string): { imported: number; skipped: boolean } {
    if (!Array.isArray(recordings) || recordings.length > 1000)
      throw new Error('Legacy recording library must contain at most 1,000 recordings');
    const key = `migrated:${source}:${createHash('sha256').update(JSON.stringify(recordings)).digest('hex')}`;
    if (this.db.prepare('SELECT 1 FROM meta WHERE key=?').get(key))
      return { imported: 0, skipped: true };
    const parsed = recordings.map(parseRecording);
    this.checkQuota(parsed);
    this.transaction(() => {
      const expected = parsed.reduce((sum, recording) => sum + recording.messages.length, 0);
      let stored = 0;
      for (const recording of parsed) {
        const id = this.insertRecording(recording);
        stored += Number(
          this.db
            .prepare('SELECT count(*) count FROM recording_messages WHERE recording_id=?')
            .get(id)!.count,
        );
      }
      if (stored !== expected) throw new Error('Migrated message count does not match');
      this.db.prepare('INSERT INTO meta VALUES(?,?)').run(key, String(Date.now()));
    });
    return { imported: parsed.length, skipped: false };
  }

  /** A comma-separated chunk of export entries in the recordingInfo/messages file format. */
  exportChunk(recordingId: number, after: number): { json: string; cursor: number | null } {
    const owner = this.db
      .prepare('SELECT connection_id FROM recordings WHERE id=?')
      .get(recordingId);
    if (!owner) throw new Error('Recording not found');
    const entries: string[] = [];
    let bytes = 0;
    let cursor: number | null = null;
    let lastSeq = after;
    for (const row of this.db
      .prepare(
        'SELECT * FROM recording_messages WHERE recording_id=? AND seq>? ORDER BY seq LIMIT ?',
      )
      .iterate(recordingId, after, this.limits.exportRows + 1)) {
      if (entries.length >= this.limits.exportRows || bytes >= this.limits.exportBytes) {
        cursor = lastSeq;
        break;
      }
      lastSeq = Number(row.seq);
      const message = this.decode(
        row,
        owner.connection_id === null ? null : String(owner.connection_id),
      );
      const entry = JSON.stringify({
        timestamp: new Date(message.timestamp).toISOString(),
        topic: message.topic,
        payload: message.message,
        encoding: message.encoding,
        qos: message.qos,
        retain: message.retain,
        connectionId: message.connectionId,
        protocolVersion: message.protocolVersion,
        properties: message.properties,
      });
      entries.push(entry);
      bytes += entry.length;
    }
    return { json: entries.join(','), cursor };
  }

  close(): void {
    this.db.close();
  }
}
