/**
 * RingBuffer — A bounded circular buffer with dual item-count and byte-size constraints.
 *
 * Unlike a plain Array, this buffer:
 *  - Uses fixed pre-allocated storage (no growing/shrinking arrays)
 *  - Drops oldest entries when item count OR total byte size exceeds limits
 *  - Evicts via pointer advancement (O(1), no splice/filter garbage)
 *  - Compacts the underlying array periodically to prevent sparse growth
 *
 * @template T — Items must have a `length` property (number of bytes).
 */
class RingBuffer {
  /**
   * @param {number} maxItems  Maximum number of entries before eviction
   * @param {number} maxBytes  Maximum total byte size of stored entries
   * @param {number} [compactionFactor=10]  Compact when end > compactionFactor * maxItems
   */
  constructor(maxItems = 300, maxBytes = 2 * 1024 * 1024, compactionFactor = 10) {
    this.maxItems = maxItems;
    this.maxBytes = maxBytes;
    this.compactionFactor = compactionFactor;

    /** @type {Array<T>} */
    this._items = [];
    this._start = 0;  // Index of first valid item (inclusive)
    this._end = 0;    // Index of next write slot (exclusive)
    this._byteUsage = 0;
  }

  /** Number of items currently stored */
  get count() {
    return this._end - this._start;
  }

  /** Current byte usage */
  get byteUsage() {
    return this._byteUsage;
  }

  /**
   * Add an item to the buffer. If limits are exceeded, oldest items are evicted.
   * @param {T} item
   */
  add(item) {
    const itemBytes = (item && typeof item.length === 'number') ? item.length : 0;

    // Evict oldest items if adding this would exceed byte limit
    while (this._byteUsage + itemBytes > this.maxBytes && this.count > 0) {
      this._dropFirst();
    }

    // Evict oldest items if at item count limit
    while (this.count >= this.maxItems) {
      this._dropFirst();
    }

    this._items[this._end] = item;
    this._end += 1;
    this._byteUsage += itemBytes;

    // Compact when the array gets too sparse
    if (this._end > this.compactionFactor * this.maxItems) {
      this._compact();
    }
  }

  /**
   * Returns a NEW array copy of all stored items from oldest to newest.
   * Only called when a topic is selected for viewing.
   * @returns {Array<T>}
   */
  toArray() {
    if (this.count <= 0) return [];
    return this._items.slice(this._start, this._end);
  }

  /** Returns the most recent item, or undefined if empty */
  last() {
    if (this.count <= 0) return undefined;
    return this._items[this._end - 1];
  }

  /** Remove all items and reset */
  clear() {
    // Null out references to allow GC
    for (let i = this._start; i < this._end; i++) {
      this._items[i] = undefined;
    }
    this._items = [];
    this._start = 0;
    this._end = 0;
    this._byteUsage = 0;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  _dropFirst() {
    const item = this._items[this._start];
    const itemBytes = (item && typeof item.length === 'number') ? item.length : 0;
    delete this._items[this._start];
    this._start += 1;
    this._byteUsage = Math.max(0, this._byteUsage - itemBytes);
  }

  _compact() {
    this._items = this.toArray();
    this._start = 0;
    this._end = this._items.length;
  }
}

export default RingBuffer;
