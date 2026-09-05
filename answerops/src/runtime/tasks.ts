/** Keeps ownership of fire-and-forget work until shutdown can safely release its resources. */
export class BackgroundTasks {
  private pending = new Set<Promise<unknown>>();
  track<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task);
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task),
    );
    return task;
  }
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
