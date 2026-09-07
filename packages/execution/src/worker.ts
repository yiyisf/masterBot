import type { ConversationModule } from '@cmaster/conversations';
import {
  ContextBuildFailureError,
  ContextCompressionRequiredError,
  ContextInputTooLargeError,
  ContextSourceIntegrityError,
  contextInvocationId,
  contextRunId,
  type ContextBuilder,
  type InvocationContext,
} from '@cmaster/context';
import type { ModelFailure, ModelGateway } from '@cmaster/models';
import {
  ExecutionLimitExceededError,
  type AgentEngine,
  type EngineEvent,
  type EngineInvocation,
} from './engine.js';
import { PostgresExecutionModule, type RunLease } from './postgres.js';
import {
  StaleLeaseError,
  type ExecutionProgressEvent,
  type PreparedRunOutput,
  type RunFailure,
} from './types.js';

/** Optional Harness composition enabled only for the pinned Context-capable Agent Revision. */
export interface ContextExecutionRuntime {
  agentRevisionId: RunLease['agentRevisionId'];
  builder: ContextBuilder;
  models: Pick<ModelGateway, 'resolveContextBudget'>;
  resolveFixedOverheadTokens(input: EngineInvocation): Promise<number>;
}

export interface RunWorkerConfig {
  workerId: string;
  leaseTtlMs: number;
  maxAttempts: number;
  outputFlushIntervalMs?: number;
  outputFlushCharacters?: number;
}

export class RunWorker {
  private readonly engines: ReadonlyMap<string, AgentEngine>;

  constructor(
    private readonly execution: PostgresExecutionModule,
    private readonly conversations: ConversationModule,
    engines: readonly AgentEngine[],
    private readonly config: RunWorkerConfig,
    private readonly contextRuntime?: ContextExecutionRuntime,
  ) {
    this.engines = new Map(engines.map((engine) => [`${engine.kind}:${engine.version}`, engine]));
  }

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

    const leaseController = new AbortController();
    const heartbeat = setInterval(() => {
      void this.execution.heartbeat(lease, this.config.leaseTtlMs).catch(() => {
        // Lease 丢失后立即停止 Provider 流，避免旧 Worker 与恢复 Worker 并行消耗模型。
        leaseController.abort();
      });
    }, Math.max(10, Math.floor(this.config.leaseTtlMs / 3)));

    try {
      const output = lease.preparedOutput ?? await this.executeEngine(lease, leaseController.signal);
      if (output === undefined) return true;
      const prepared = await this.execution.saveOutputReady(lease, output);
      if (prepared === 'cancelled') return true;

      const message = await this.conversations.appendAssistantMessage({
        organizationId: lease.organizationId,
        conversationId: lease.conversationId,
        sourceRunId: lease.runId,
        sourceInvocationId: lease.invocationId,
        parts: [
          { type: 'text', text: output.text },
          ...output.artifactReferences.map((reference) => ({
            type: 'artifact_reference' as const,
            ...reference,
          })),
        ],
      });
      await this.execution.complete(lease, message.value.id);
      return true;
    } catch (error) {
      if (error instanceof StaleLeaseError) return true;
      // output_ready 后的交付必须等待 Lease 到期再幂等恢复，不能把已有 Message 的 Run 标记失败。
      return true;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async executeEngine(
    lease: RunLease,
    signal: AbortSignal,
  ): Promise<PreparedRunOutput | undefined> {
    // Slice 2 只投影触发它的 Employee Text Message；历史、Memory/Knowledge 由 Context Builder Slice 接管。
    const trigger = await this.conversations.getMessageTrigger(
      lease.organizationId,
      lease.messageId,
    );
    let invocationContext: InvocationContext | undefined;
    if (this.contextRuntime?.agentRevisionId === lease.agentRevisionId) {
      try {
        if (lease.contextManifestId) {
          invocationContext = await this.contextRuntime.builder.materialize({
            organizationId: lease.organizationId,
            principalId: lease.initiatingPrincipalId,
            manifestId: lease.contextManifestId,
          });
        } else {
          const modelBudget = await this.contextRuntime.models.resolveContextBudget({
            organizationId: lease.organizationId,
            requiresToolCalling: true,
          });
          const fixedOverheadTokens = await this.contextRuntime.resolveFixedOverheadTokens({
            organizationId: lease.organizationId,
            runId: lease.runId,
            invocationId: lease.invocationId,
            agentRevisionId: lease.agentRevisionId,
            prompt: trigger.prompt,
          });
          const built = await this.contextRuntime.builder.build({
            organizationId: lease.organizationId,
            principalId: lease.initiatingPrincipalId,
            invocationId: contextInvocationId(lease.invocationId),
            conversationId: lease.conversationId,
            triggerMessageId: lease.messageId,
            modelBudget,
            fixedOverheadTokens,
            summaryExecution: {
              runId: contextRunId(lease.runId),
              signal,
            },
          });
          await this.execution.attachContextManifest(lease, {
            manifestId: built.manifest.id,
            invocationId: lease.invocationId,
            itemCount: built.manifest.itemCount,
            summarized: built.manifest.summarized,
            estimatedInputTokens: built.manifest.estimatedInputTokens,
            contextPolicyRevision: built.manifest.contextPolicyRevision,
          });
          invocationContext = built.invocationContext;
        }
      } catch (error) {
        if (error instanceof StaleLeaseError) throw error;
        const inputTooLarge = error instanceof ContextInputTooLargeError;
        const sourceIntegrityFailure = error instanceof ContextSourceIntegrityError;
        const compressionRequired = error instanceof ContextCompressionRequiredError;
        const classifiedBuildFailure = error instanceof ContextBuildFailureError
          ? error.retryable
          : undefined;
        await this.execution.fail(lease, {
          code: inputTooLarge ? 'context_input_too_large' : 'context_build_failed',
          message: inputTooLarge
            ? 'The required Invocation Context exceeds the approved input limit.'
            : 'The Invocation Context could not be built.',
          retryable: classifiedBuildFailure
            ?? (!inputTooLarge && !sourceIntegrityFailure && !compressionRequired),
        });
        return undefined;
      }
    }
    const engine = this.engines.get(`${lease.engineKind}:${lease.engineVersion}`);
    if (!engine) {
      await this.execution.fail(lease, {
        code: 'engine_failed',
        message: 'The configured Agent Engine is unavailable.',
        retryable: false,
      });
      return undefined;
    }

    let generation = lease.outputGeneration;
    let output = '';
    let pending = '';
    let outputStarted = false;
    let completed = false;
    let artifactReferences: PreparedRunOutput['artifactReferences'] = [];
    let interrupted = false;
    let terminalModelFailure: ModelFailure | undefined;
    let lastFlushAt = Date.now();
    const flushIntervalMs = this.config.outputFlushIntervalMs ?? 100;
    const flushCharacters = this.config.outputFlushCharacters ?? 256;

    const record = async (...events: ExecutionProgressEvent[]): Promise<void> => {
      await this.execution.recordProgress(lease, events);
    };
    const flush = async (): Promise<void> => {
      if (pending.length === 0) return;
      const events: ExecutionProgressEvent[] = [];
      if (!outputStarted) {
        events.push({ type: 'output_started', generation });
        outputStarted = true;
      }
      events.push({ type: 'output_delta', generation, text: pending });
      pending = '';
      lastFlushAt = Date.now();
      await this.execution.recordProgress(lease, events);
    };

    try {
      if (lease.attemptNumber > 1 && lease.hasStreamedOutput) {
        generation += 1;
        // 旧 Worker 可能已留下部分 Delta；恢复时先重置投影，再重新调用模型。
        await record({ type: 'output_reset', generation, reason: 'recovery' });
      }

      for await (const event of engine.execute({
        organizationId: lease.organizationId,
        runId: lease.runId,
        invocationId: lease.invocationId,
        agentRevisionId: lease.agentRevisionId,
        prompt: trigger.prompt,
        ...(invocationContext ? { invocationContext } : {}),
        outputGeneration: generation,
        ...(lease.checkpoint ? { checkpoint: lease.checkpoint } : {}),
        ...(lease.resumeResponse ? { resumeResponse: lease.resumeResponse } : {}),
      }, signal)) {
        if (event.type === 'text_delta') {
          output += event.text;
          pending += event.text;
          if (pending.length >= flushCharacters || Date.now() - lastFlushAt >= flushIntervalMs) {
            await flush();
          }
          continue;
        }
        await flush();
        if (event.type === 'checkpoint_reached') {
          await this.execution.saveCheckpoint(lease, event.checkpoint);
          continue;
        }
        if (event.type === 'interrupt_requested') {
          await this.execution.requestInterrupt(lease, {
            kind: event.kind,
            subjectRef: event.subjectRef,
            safeSubjectSummary: event.safeSubjectSummary,
            allowedResponses: event.allowedResponses,
            checkpoint: event.checkpoint,
          });
          interrupted = true;
          break;
        }
        await this.recordEngineEvent(lease, event, record, async (reason) => {
          output = '';
          pending = '';
          outputStarted = false;
          generation += 1;
          await record({ type: 'output_reset', generation, reason });
        });
        if (event.type === 'model_failed') terminalModelFailure = event.failure;
        if (event.type === 'completed') {
          completed = true;
          artifactReferences = event.artifactReferences;
        }
      }
      await flush();

      if (interrupted) return undefined;
      if (terminalModelFailure) {
        const failure: RunFailure = {
          code: 'model_failed',
          message: terminalModelFailure.message,
          retryable: terminalModelFailure.retryable,
        };
        await this.execution.fail(lease, failure);
        return undefined;
      }
      if (!completed || output.length === 0) throw new Error('Engine ended without completed text output');
      await record({ type: 'output_completed', generation });
      return { text: output, artifactReferences };
    } catch (error) {
      if (error instanceof StaleLeaseError) throw error;
      const failure: RunFailure = error instanceof ExecutionLimitExceededError
        ? {
          code: 'execution_limit_exceeded',
          message: 'The Agent execution limit was exceeded.',
          retryable: false,
        }
        : {
          code: 'engine_failed',
          message: 'The Agent Engine could not complete the run.',
          retryable: true,
        };
      await this.execution.fail(lease, failure);
      return undefined;
    }
  }

  private async recordEngineEvent(
    lease: RunLease,
    event: Exclude<EngineEvent, { type: 'text_delta' }>,
    record: (...events: ExecutionProgressEvent[]) => Promise<void>,
    resetOutput: (reason: 'fallback' | 'failure') => Promise<void>,
  ): Promise<void> {
    switch (event.type) {
      case 'artifact_created':
        await record({
          type: 'artifact_created',
          toolCallId: event.toolCallId,
          invocationId: lease.invocationId,
          reference: event.artifact.reference,
          kind: event.artifact.kind,
          mediaType: event.artifact.mediaType,
        });
        break;
      case 'model_selected':
        await record({
          type: 'model_selected',
          profileId: event.profile.id,
          displayName: event.profile.displayName,
          fallback: event.fallback,
        });
        break;
      case 'model_output_discarded':
        await record({
          type: 'model_output_discarded', profileId: event.profileId, reason: event.reason,
        });
        await resetOutput(event.reason);
        break;
      case 'model_fallback_selected':
        await record({
          type: 'model_fallback_selected',
          fromProfileId: event.fromProfileId,
          toProfileId: event.toProfile.id,
          displayName: event.toProfile.displayName,
        });
        break;
      case 'model_completed':
        await record({
          type: 'model_completed',
          profileId: event.profile.id,
          usage: event.usage,
          fallbackUsed: event.fallbackUsed,
        });
        break;
      case 'model_failed':
        await record({
          type: 'model_failed',
          profileId: event.profile.id,
          failure: event.failure,
          hadOutput: event.hadOutput,
        });
        break;
      case 'tool_status':
        await record({
          type: 'tool_status',
          status: event.status,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          safeSummary: event.safeSummary,
        });
        break;
      case 'completed':
        break;
      case 'interrupt_requested':
      case 'checkpoint_reached':
        break;
    }
  }
}
