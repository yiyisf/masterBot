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
import type { InvocationId, RunId } from './types.js';

export interface EngineInvocation {
  organizationId: OrganizationId;
  runId: RunId;
  invocationId: InvocationId;
  agentRevisionId: AgentRevisionId;
  prompt: string;
}

export interface AgentToolRuntime {
  list(input: EngineInvocation): Promise<readonly ModelAvailableTool[]>;
  invoke(input: EngineInvocation, request: ModelRequestedTool): Promise<{
    kind: 'completed';
    modelOutput: unknown;
  }>;
}

export type EngineEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'model_selected'; profile: ModelSelection; fallback: boolean }
  | { type: 'model_output_discarded'; profileId: ModelProfileId; reason: 'fallback' | 'failure' }
  | { type: 'model_fallback_selected'; fromProfileId: ModelProfileId; toProfile: ModelSelection }
  | { type: 'model_completed'; profile: ModelSelection; usage: ModelUsage; fallbackUsed: boolean }
  | { type: 'model_failed'; profile: ModelSelection; failure: ModelFailure; hadOutput: boolean }
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
    const transcript: ModelTranscriptMessage[] = [{ role: 'user', text: input.prompt }];
    const availableTools = this.tools ? await this.tools.list(input) : undefined;
    let toolCallCount = 0;

    for (let modelStep = 1; modelStep <= 5; modelStep += 1) {
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
      if (!this.tools) throw new ExecutionLimitExceededError('Model requested an unavailable Tool');
      transcript.push({ role: 'assistant', text: assistantText, toolRequests: requestedTools });
      for (const request of requestedTools) {
        toolCallCount += 1;
        if (toolCallCount > 8) throw new ExecutionLimitExceededError('Tool call limit exceeded');
        const outcome = await this.tools.invoke(input, request);
        transcript.push({
          role: 'tool',
          requestId: request.requestId,
          name: request.name,
          output: outcome.modelOutput,
        });
      }
    }
    throw new ExecutionLimitExceededError('Model step limit exceeded');
  }
}

export class ExecutionLimitExceededError extends Error {
}
