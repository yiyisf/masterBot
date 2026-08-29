import { EventEmitter } from 'node:events';
import { Client } from 'pg';

export interface RunEventNotifier {
  wait(runId: string, timeoutMs: number, signal: AbortSignal): Promise<void>;
}

export class PostgresRunEventNotifier implements RunEventNotifier {
  private readonly events = new EventEmitter();
  private client: Client | undefined;
  private stopped = false;

  constructor(private readonly connectionString: string) {
    this.events.setMaxListeners(0);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    const client = new Client({ connectionString: this.connectionString });
    client.on('notification', (message) => {
      if (!message.payload) return;
      try {
        const payload = JSON.parse(message.payload) as { runId?: unknown };
        if (typeof payload.runId === 'string') this.events.emit(payload.runId);
      } catch {
        // Invalid wake-up payloads are ignored; polling remains the recovery path.
      }
    });
    client.on('error', () => {
      if (!this.stopped) setTimeout(() => void this.connect().catch(() => undefined), 1_000);
    });
    await client.connect();
    await client.query('LISTEN cmaster_run_events');
    this.client = client;
  }

  async wait(runId: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        this.events.removeListener(runId, finish);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.events.once(runId, finish);
      signal.addEventListener('abort', finish, { once: true });
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.events.removeAllListeners();
    const client = this.client;
    this.client = undefined;
    await client?.end();
  }
}

export class PollingRunEventNotifier implements RunEventNotifier {
  async wait(_runId: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}
