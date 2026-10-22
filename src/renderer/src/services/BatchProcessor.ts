import type { IncomingPublish, MessageBatch } from '../../../shared/traffic';

/** Yield between short slices; acknowledgement comes only after every subscriber ran. */
export class BatchProcessor {
  private active = false;

  constructor(
    private deliver: (message: IncomingPublish) => void,
    private acknowledge: (batchId: number) => void,
  ) {}

  accept(batch: MessageBatch): void {
    if (this.active) throw new Error('Received a second batch before acknowledgement');
    this.active = true;
    let index = 0;
    const step = () => {
      const start = performance.now();
      let count = 0;
      while (index < batch.messages.length && count < 25 && performance.now() - start < 4) {
        this.deliver(batch.messages[index++]);
        count++;
      }
      if (index < batch.messages.length) setTimeout(step, 0);
      else {
        this.active = false;
        this.acknowledge(batch.batchId);
      }
    };
    setTimeout(step, 0);
  }
}
