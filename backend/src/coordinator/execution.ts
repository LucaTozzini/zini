// The graph stream may close before aborted nodes/tools have unwound.
export class PipelineExecution {
  private pending = new Set<Promise<unknown>>();

  async track<T>(work: () => Promise<T>): Promise<T> {
    const task = work();
    this.pending.add(task);
    try { return await task; }
    finally { this.pending.delete(task); }
  }

  async *stream<T>(source: Promise<AsyncIterable<T>>): AsyncGenerator<T> {
    try { yield* await source; }
    finally {
      while (this.pending.size) await Promise.allSettled(this.pending);
    }
  }
}
