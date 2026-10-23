export interface NumericPoint {
  x: number;
  y: number;
  breakBefore?: boolean;
}
export interface NumericQuery {
  connectionId: string;
  topic: string;
  paths: string[][];
  from: number;
  to: number;
  maxPoints: number;
}
export interface NumericResult {
  from: number;
  to: number;
  scanned: number;
  truncated: boolean;
  availablePaths: string[][];
  series: { path: string[]; points: NumericPoint[]; valid: number; gaps: number }[];
}

export const fieldPointer = (path: string[]) =>
  path.map((segment) => '/' + segment.replace(/~/g, '~0').replace(/\//g, '~1')).join('');
export function pointerPath(pointer: string): string[] {
  if (!pointer) return [];
  if (!pointer.startsWith('/') || /~(?![01])/u.test(pointer))
    throw new Error(
      'Use a JSON pointer, for example /temperature or /sensors/0/value. Escape / as ~1 and ~ as ~0.',
    );
  const path = pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (path.length > 16 || pointer.length > 1024) throw new Error('Field path is too long.');
  return path;
}

export function numericPayload(bytes: Uint8Array | null): unknown {
  if (!bytes || bytes.byteLength > 65536) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : undefined;
    }
  } catch {
    return undefined;
  }
}

export function numericField(value: unknown, path: string[]): number | null {
  for (const segment of path) {
    if (
      !value ||
      typeof value !== 'object' ||
      !Object.prototype.hasOwnProperty.call(value, segment)
    )
      return null;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface Sample {
  x: number;
  y: number;
  order: number;
}
interface Bucket {
  first: Sample;
  last: Sample;
  min: Sample;
  max: Sample;
}

/** Extrema-preserving time buckets. Broken buckets remain disconnected, never filled with zero. */
export class NumericSampler {
  private bins: Map<number, Bucket>[];
  private gaps: Set<number>[];
  private valid: number[];
  private missing: number[];
  private available = new Map<string, string[]>();
  private previousSession?: string;
  private binsCount: number;
  private scanned = 0;

  constructor(private query: NumericQuery) {
    this.binsCount = Math.max(1, Math.floor(query.maxPoints / 4));
    this.bins = query.paths.map(() => new Map());
    this.gaps = query.paths.map(() => new Set());
    this.valid = query.paths.map(() => 0);
    this.missing = query.paths.map(() => 0);
  }

  add(timestamp: number, order: number, session: string, payload: Uint8Array | null): void {
    this.scanned++;
    const value = numericPayload(payload);
    if (this.scanned <= 20) this.discover(value);
    const index = Math.min(
      this.binsCount - 1,
      Math.max(
        0,
        Math.floor(
          ((timestamp - this.query.from) / Math.max(1, this.query.to - this.query.from)) *
            this.binsCount,
        ),
      ),
    );
    const newSession = this.previousSession !== undefined && session !== this.previousSession;
    this.previousSession = session;
    for (let field = 0; field < this.query.paths.length; field++) {
      const y = numericField(value, this.query.paths[field]);
      if (y === null || newSession) this.gaps[field].add(index);
      if (y === null) {
        this.missing[field]++;
        continue;
      }
      this.valid[field]++;
      const sample = { x: timestamp, y, order };
      let bucket = this.bins[field].get(index);
      if (!bucket) {
        bucket = { first: sample, last: sample, min: sample, max: sample };
        this.bins[field].set(index, bucket);
      }
      if (
        timestamp < bucket.first.x ||
        (timestamp === bucket.first.x && order < bucket.first.order)
      )
        bucket.first = sample;
      if (timestamp > bucket.last.x || (timestamp === bucket.last.x && order > bucket.last.order))
        bucket.last = sample;
      if (y < bucket.min.y) bucket.min = sample;
      if (y > bucket.max.y) bucket.max = sample;
    }
  }

  private discover(value: unknown): void {
    const pending = [{ value, path: [] as string[] }];
    let visited = 0;
    while (pending.length && this.available.size < 64 && ++visited < 256) {
      const item = pending.pop()!;
      if (numericField(item.value, []) !== null)
        this.available.set(fieldPointer(item.path), item.path);
      else if (item.value && typeof item.value === 'object' && item.path.length < 8) {
        for (const key of Object.keys(item.value).slice(0, 64).reverse())
          pending.push({
            value: (item.value as Record<string, unknown>)[key],
            path: [...item.path, key],
          });
      }
    }
  }

  result(truncated = false): NumericResult {
    return {
      from: this.query.from,
      to: this.query.to,
      scanned: this.scanned,
      truncated,
      availablePaths: [...this.available.values()],
      series: this.query.paths.map((path, field) => {
        const points: NumericPoint[] = [];
        let previousBin = -1;
        let previousBroken = false;
        for (const [index, bucket] of [...this.bins[field]].sort(([a], [b]) => a - b)) {
          const broken = this.gaps[field].has(index);
          const betweenGap = [...this.gaps[field]].some((gap) => gap > previousBin && gap < index);
          const samples = [
            ...new Map(
              [bucket.first, bucket.min, bucket.max, bucket.last].map((sample) => [
                sample.order,
                sample,
              ]),
            ).values(),
          ].sort((a, b) => a.x - b.x || a.order - b.order);
          samples.forEach((sample, position) =>
            points.push({
              x: sample.x,
              y: sample.y,
              breakBefore: broken || (position === 0 && (previousBroken || betweenGap)),
            }),
          );
          previousBin = index;
          previousBroken = broken;
        }
        return { path, points, valid: this.valid[field], gaps: this.missing[field] };
      }),
    };
  }
}
