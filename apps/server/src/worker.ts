import type { DatabaseHealth } from './postgres.js';

export interface WorkerCycle {
  relayOne(): Promise<boolean>;
  executeOne(): Promise<boolean>;
}

export interface WorkerRuntimeOptions {
  pollIntervalMs: number;
  concurrency: number;
}

export class WorkerRuntime {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly database: DatabaseHealth,
    private readonly cycle?: WorkerCycle,
    private readonly options: WorkerRuntimeOptions = { pollIntervalMs: 500, concurrency: 1 },
  ) {}

  async start(): Promise<void> {
    if (!(await this.database.check())) {
      throw new Error('Worker cannot start while PostgreSQL is unavailable');
    }
    if (this.cycle) void this.tick().catch(() => undefined);
    this.timer = setInterval(() => void this.tick().catch(() => undefined), this.options.pollIntervalMs);
  }

  private async tick(): Promise<void> {
    if (this.running || !this.cycle) return;
    this.running = true;
    try {
      while (await this.cycle.relayOne()) {
        // Drain durable dispatch requests before leasing work.
      }
      await Promise.all(
        Array.from({ length: this.options.concurrency }, () => this.cycle!.executeOne()),
      );
    } finally {
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
