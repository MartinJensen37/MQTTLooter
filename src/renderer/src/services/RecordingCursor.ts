import type { RecordingPage, StoredRecordingMessage } from '../../../shared/recording';

type PageLoader = (query: {
  after?: number;
  before?: number;
  limit: number;
}) => Promise<RecordingPage>;

const PAGE = 256;
const MAX_WINDOW = 2048;

/**
 * Index-addressed access to a recording's messages in capture order through a bounded window of
 * pages. Forward reads extend the window; short backward steps page backwards; far jumps restart
 * from the beginning. Calls are serialized so concurrent readers never interleave page loads.
 */
export class RecordingCursor {
  private window: StoredRecordingMessage[] = [];
  private start = 0;
  private after: number | undefined;
  private before: number | undefined;
  private endReached = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private load: PageLoader) {}

  at(index: number): Promise<StoredRecordingMessage | undefined> {
    const task = this.queue.then(() => this.read(index));
    this.queue = task.catch(() => {});
    return task;
  }

  private reset(): void {
    this.window = [];
    this.start = 0;
    this.after = undefined;
    this.before = undefined;
    this.endReached = false;
  }

  private async read(index: number): Promise<StoredRecordingMessage | undefined> {
    if (index < 0) return undefined;
    if (index < this.start) {
      if (this.start - index > PAGE) this.reset();
      while (index < this.start) if (!(await this.backward())) this.reset();
    }
    // At the end, retry once in case an active capture has grown since.
    if (index >= this.start + this.window.length && this.endReached) this.endReached = false;
    while (index >= this.start + this.window.length && !this.endReached) await this.forward();
    return this.window[index - this.start];
  }

  private async forward(): Promise<void> {
    const page = await this.load({ after: this.after, limit: PAGE });
    if (!this.window.length && page.messages.length) this.before = page.messages[0].seq;
    this.window.push(...page.messages);
    this.after = page.cursor ?? page.messages.at(-1)?.seq ?? this.after;
    this.endReached = page.cursor === null;
    if (this.window.length > MAX_WINDOW) {
      const dropped = this.window.length - MAX_WINDOW / 2;
      this.window.splice(0, dropped);
      this.start += dropped;
      this.before = this.window[0].seq;
    }
  }

  /** Returns false when the window cannot move back, which only happens if the data changed. */
  private async backward(): Promise<boolean> {
    if (this.before === undefined) return false;
    const page = await this.load({ before: this.before, limit: PAGE });
    this.window.unshift(...page.messages);
    this.start -= page.messages.length;
    this.before = page.cursor ?? this.before;
    if (page.cursor === null && this.start !== 0) return false;
    if (this.start < 0) return false;
    if (this.window.length > MAX_WINDOW) {
      this.window.length = MAX_WINDOW / 2;
      this.after = this.window.at(-1)!.seq;
      this.endReached = false;
    }
    return true;
  }
}
