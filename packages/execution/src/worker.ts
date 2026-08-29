import type { ConversationModule } from '@cmaster/conversations';
import type { AgentEngine } from './engine.js';
import { PostgresExecutionModule, type RunLease } from './postgres.js';
import { StaleLeaseError, type RunFailure } from './types.js';

export interface RunWorkerConfig {
  workerId: string;
  leaseTtlMs: number;
  maxAttempts: number;
}

export class RunWorker {
  constructor(
    private readonly execution: PostgresExecutionModule,
    private readonly conversations: ConversationModule,
    private readonly engine: AgentEngine,
    private readonly config: RunWorkerConfig,
  ) {}

  async relayOne(): Promise<boolean> {
    return this.execution.relayNextOutbox();
  }

  async executeOne(): Promise<boolean> {
    const lease = await this.execution.leaseNext(
      this.config.workerId,
      this.config.leaseTtlMs,
      this.config.maxAttempts,
    );
    if (!lease) return false;

    const heartbeat = setInterval(() => {
      void this.execution.heartbeat(lease, this.config.leaseTtlMs).catch(() => undefined);
    }, Math.max(10, Math.floor(this.config.leaseTtlMs / 3)));

    try {
      const output = lease.preparedOutput ?? await this.executeEngine(lease);
      if (output === undefined) return true;
      const prepared = await this.execution.saveOutputReady(lease, output);
      if (prepared === 'cancelled') return true;

      const message = await this.conversations.appendAssistantMessage({
        organizationId: lease.organizationId,
        conversationId: lease.conversationId,
        sourceRunId: lease.runId,
        sourceInvocationId: lease.invocationId,
        parts: [{ type: 'text', text: output }],
      });
      await this.execution.complete(lease, message.value.id);
      return true;
    } catch (error) {
      if (error instanceof StaleLeaseError) return true;
      // Output delivery is retried after lease expiry. Engine failures are finalized in executeEngine.
      return true;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async executeEngine(lease: RunLease): Promise<string | undefined> {
    const trigger = await this.conversations.getMessageTrigger(
      lease.organizationId,
      lease.messageId,
    );
    const controller = new AbortController();
    let output = '';
    let completed = false;
    try {
      for await (const event of this.engine.execute({
        invocationId: lease.invocationId,
        prompt: trigger.prompt,
      }, controller.signal)) {
        if (event.type === 'text_delta') output += event.text;
        if (event.type === 'completed') completed = true;
      }
      if (!completed) throw new Error('Engine ended without a completed event');
      return output;
    } catch {
      const failure: RunFailure = {
        code: 'engine_failed',
        message: 'The Echo engine could not complete the run.',
        retryable: true,
      };
      await this.execution.fail(lease, failure);
      return undefined;
    }
  }
}
