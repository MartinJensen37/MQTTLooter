/**
 * RingBuffer — bounded circular buffer with dual item-count and byte-size limits.
 *
 * Unlike a plain Array it:
 *  - drops oldest entries when item count OR total byte size exceeds limits,
 *  - evicts via pointer advancement (O(1), no splice/filter garbage),
 *  - compacts the backing array periodically to prevent sparse growth.
 *
 * Items carry an optional `length` (byte size) used for the byte-budget accounting.
 */
class RingBuffer<T extends { length?: number }> {
  maxItems: number;
  maxBytes: number;
  compactionFactor: number;

  private _items: (T | undefined)[] = [];
  private _start = 0; // index of first valid item (inclusive)
  private _end = 0; // index of next write slot (exclusive)
  private _byteUsage = 0;

  constructor(maxItems = 300, maxBytes = 2 * 1024 * 1024, compactionFactor = 10) {
    this.maxItems = maxItems;
    this.maxBytes = maxBytes;
    this.compactionFactor = compactionFactor;
  }

  get count(): number {
    return this._end - this._start;
  }

  get byteUsage(): number {
    return this._byteUsage;
  }

  /** Add an item, evicting oldest entries if the count or byte limit would be exceeded. */
  add(item: T): void {
    const itemBytes = typeof item?.length === 'number' ? item.length : 0;

    while (this._byteUsage + itemBytes > this.maxBytes && this.count > 0) {
      this._dropFirst();
    }
    while (this.count >= this.maxItems) {
      this._dropFirst();
    }

    this._items[this._end] = item;
    this._end += 1;
    this._byteUsage += itemBytes;

    // Compact when the backing array gets too sparse.
    if (this._end > this.compactionFactor * this.maxItems) {
      this._compact();
    }
  }

  /** New array copy of all items, oldest → newest. */
  toArray(): T[] {
    if (this.count <= 0) return [];
    return this._items.slice(this._start, this._end) as T[];
  }

  /** Most recent item, or undefined if empty. */
  last(): T | undefined {
    if (this.count <= 0) return undefined;
    return this._items[this._end - 1];
  }

  clear(): void {
    this._items = [];
    this._start = 0;
    this._end = 0;
    this._byteUsage = 0;
  }

  private _dropFirst(): void {
    const item = this._items[this._start];
    const itemBytes = typeof item?.length === 'number' ? item.length : 0;
    delete this._items[this._start];
    this._start += 1;
    this._byteUsage = Math.max(0, this._byteUsage - itemBytes);
  }

  private _compact(): void {
    this._items = this.toArray();
    this._start = 0;
    this._end = this._items.length;
  }
}

export default RingBuffer;
