import type { DatabaseHealth } from './postgres.js';

export class WorkerRuntime {
  private keepAlive: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly database: DatabaseHealth) {}

  async start(): Promise<void> {
    if (!(await this.database.check())) {
      throw new Error('Worker cannot start while PostgreSQL is unavailable');
    }
    this.keepAlive = setInterval(() => undefined, 60_000);
  }

  async stop(): Promise<void> {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = undefined;
  }
}
