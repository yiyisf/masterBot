import type { AgentRevisionId } from '@cmaster/agents';
import type { OrganizationId } from '@cmaster/identity';
import type {
  ModelAvailableTool,
  ModelFailure,
  ModelGateway,
  ModelProfileId,
  ModelRequestedTool,
  ModelSelection,
  ModelTranscriptMessage,
  ModelUsage,
} from '@cmaster/models';
import type {
  ExecutionCheckpoint,
  InterruptKind,
  InterruptResponse,
  InvocationId,
  RunId,
} from './types.js';

export interface EngineInvocation {
  organizationId: OrganizationId;
  runId: RunId;
  invocationId: InvocationId;
  agentRevisionId: AgentRevisionId;
  prompt: string;
  outputGeneration?: number;
  checkpoint?: ExecutionCheckpoint;
  resumeResponse?: InterruptResponse;
}

export type AgentToolOutcome =
  | { kind: 'completed'; toolCallId: string; modelOutput: unknown }
  | {
    kind: 'interrupt';
    interruptKind: InterruptKind;
    toolCallId: string;
    safeSummary: { title: string; details: Readonly<Record<string, string>> };
  };

export interface AgentToolRuntime {
  list(input: EngineInvocation): Promise<readonly ModelAvailableTool[]>;
  invoke(
    input: EngineInvocation,
    request: ModelRequestedTool,
    signal: AbortSignal,
  ): Promise<AgentToolOutcome>;
  recover(
    input: EngineInvocation,
    toolCallId: string,
    request: ModelRequestedTool,
  ): Promise<AgentToolOutcome>;
}

export type EngineEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'model_selected'; profile: ModelSelection; fallback: boolean }
  | { type: 'model_output_discarded'; profileId: ModelProfileId; reason: 'fallback' | 'failure' }
  | { type: 'model_fallback_selected'; fromProfileId: ModelProfileId; toProfile: ModelSelection }
  | { type: 'model_completed'; profile: ModelSelection; usage: ModelUsage; fallbackUsed: boolean }
  | { type: 'model_failed'; profile: ModelSelection; failure: ModelFailure; hadOutput: boolean }
  | {
    type: 'interrupt_requested';
    kind: InterruptKind;
    subjectRef: string;
    safeSubjectSummary: { title: string; details: Readonly<Record<string, string>> };
    allowedResponses: readonly InterruptResponse[];
    checkpoint: ExecutionCheckpoint;
  }
  | { type: 'completed' };

export interface AgentEngine {
  readonly kind: 'echo' | 'ai-sdk';
  readonly version: '1';
  execute(input: EngineInvocation, signal: AbortSignal): AsyncIterable<EngineEvent>;
}

export class EchoAgentEngine implements AgentEngine {
  readonly kind = 'echo' as const;
  readonly version = '1' as const;

  async *execute(input: EngineInvocation, signal: AbortSignal): AsyncIterable<EngineEvent> {
    if (signal.aborted) return;
    yield { type: 'text_delta', text: input.prompt };
    if (signal.aborted) return;
    yield { type: 'completed' };
  }
}

/**
 * Runs a provider-neutral, sequential Tool Loop. A Model Tool Request is consumed only
 * after Model Gateway has emitted model_completed; at most five Model Steps and eight
 * Tool calls are allowed, and AI SDK/Provider types never cross this seam.
 */
export class AiSdkAgentEngine implements AgentEngine {
  readonly kind = 'ai-sdk' as const;
  readonly version = '1' as const;

  constructor(
    private readonly models: ModelGateway,
    private readonly tools?: AgentToolRuntime,
  ) {}

  async *execute(input: EngineInvocation, signal: AbortSignal): AsyncIterable<EngineEvent> {
    const restored = input.checkpoint?.toolLoop;
    const transcript: ModelTranscriptMessage[] = restored
      ? [...restored.providerNeutralTranscript]
      : [{ role: 'user', text: input.prompt }];
    const availableTools = this.tools ? await this.tools.list(input) : undefined;
    let modelStepNumber = restored?.modelStepNumber ?? 0;
    let toolCallCount = restored?.toolCallCount ?? 0;
    const completedToolCallIds = [...(restored?.completedToolCallIds ?? [])];
    const pending: Array<{
      request: ModelRequestedTool;
      recoverToolCallId?: string;
    }> = restored
      ? [
        { request: restored.pendingToolRequest, recoverToolCallId: input.checkpoint!.toolCallId },
        ...restored.remainingModelToolRequests.map((request) => ({ request })),
      ]
      : [];

    while (true) {
      while (pending.length > 0) {
        if (!this.tools) throw new ExecutionLimitExceededError('Model requested an unavailable Tool');
        const current = pending.shift()!;
        let outcome: AgentToolOutcome;
        if (current.recoverToolCallId) {
          outcome = await this.tools.recover(input, current.recoverToolCallId, current.request);
        } else {
          toolCallCount += 1;
          if (toolCallCount > 8) throw new ExecutionLimitExceededError('Tool call limit exceeded');
          outcome = await this.tools.invoke(input, current.request, signal);
        }

        if (outcome.kind === 'interrupt'
          && !(outcome.interruptKind === 'tool_outcome_review'
            && input.resumeResponse === 'continue_with_uncertainty')) {
          const checkpoint: ExecutionCheckpoint = {
            schemaVersion: 1,
            engineKind: 'ai-sdk',
            engineVersion: '1',
            toolCallId: outcome.toolCallId,
            outcome: outcome.interruptKind === 'tool_confirmation'
              ? 'confirmation_required'
              : 'requires_review',
            toolLoop: {
              modelStepNumber,
              toolCallCount,
              providerNeutralTranscript: transcript,
              completedToolCallIds,
              pendingToolRequest: current.request,
              remainingModelToolRequests: pending.map((item) => item.request),
              outputGeneration: input.outputGeneration ?? 0,
            },
          };
          yield {
            type: 'interrupt_requested',
            kind: outcome.interruptKind,
            subjectRef: outcome.toolCallId,
            safeSubjectSummary: outcome.safeSummary,
            allowedResponses: outcome.interruptKind === 'tool_confirmation'
              ? ['confirm', 'reject']
              : ['continue_with_uncertainty'],
            checkpoint,
          };
          return;
        }

        const modelOutput = outcome.kind === 'completed'
          ? outcome.modelOutput
          : {
            status: 'uncertain',
            code: 'external_effect_unknown',
            message: 'The external effect is unknown.',
          };
        transcript.push({
          role: 'tool',
          requestId: current.request.requestId,
          name: current.request.name,
          output: modelOutput,
        });
        completedToolCallIds.push(outcome.toolCallId);
      }

      modelStepNumber += 1;
      if (modelStepNumber > 5) throw new ExecutionLimitExceededError('Model step limit exceeded');
      let completed = false;
      let assistantText = '';
      const requestedTools: ModelRequestedTool[] = [];
      for await (const event of this.models.stream({
        organizationId: input.organizationId,
        runId: input.runId,
        invocationId: input.invocationId,
        prompt: input.prompt,
        transcript,
        ...(availableTools ? { tools: availableTools } : {}),
        signal,
      })) {
        switch (event.type) {
          case 'model_selected':
            yield { type: 'model_selected', profile: event.profile, fallback: event.fallback };
            break;
          case 'text_delta':
            assistantText += event.text;
            yield event;
            break;
          case 'model_output_discarded':
            yield event;
            break;
          case 'model_fallback_selected':
            yield event;
            break;
          case 'model_completed':
            completed = true;
            yield {
              type: 'model_completed',
              profile: event.profile,
              usage: event.usage,
              fallbackUsed: event.fallbackUsed,
            };
            break;
          case 'tool_requested':
            requestedTools.push(event.request);
            break;
          case 'model_failed':
            yield {
              type: 'model_failed',
              profile: event.profile,
              failure: event.failure,
              hadOutput: event.hadOutput,
            };
            return;
        }
      }
      if (!completed) return;
      if (requestedTools.length === 0) {
        yield { type: 'completed' };
        return;
      }
      transcript.push({ role: 'assistant', text: assistantText, toolRequests: requestedTools });
      pending.push(...requestedTools.map((request) => ({ request })));
    }
  }
}

export class ExecutionLimitExceededError extends Error {
}
