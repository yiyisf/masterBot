import type { OrganizationId } from '@cmaster/identity';
import type {
  ModelFailure,
  ModelGateway,
  ModelProfileId,
  ModelSelection,
  ModelUsage,
} from '@cmaster/models';
import type { InvocationId, RunId } from './types.js';

export interface EngineInvocation {
  organizationId: OrganizationId;
  runId: RunId;
  invocationId: InvocationId;
  prompt: string;
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
 * Slice 2 的 AI SDK Agent Engine 暂时只有一次模型调用，不包含 Tool Loop。
 * Slice 3 接入 Tool Runtime 时会在此 Adapter 内扩展迭代，但外层 Run/Lease Interface 不改变。
 */
export class AiSdkAgentEngine implements AgentEngine {
  readonly kind = 'ai-sdk' as const;
  readonly version = '1' as const;

  constructor(private readonly models: ModelGateway) {}

  async *execute(input: EngineInvocation, signal: AbortSignal): AsyncIterable<EngineEvent> {
    let completed = false;
    for await (const event of this.models.stream({
      organizationId: input.organizationId,
      runId: input.runId,
      invocationId: input.invocationId,
      prompt: input.prompt,
      signal,
    })) {
      switch (event.type) {
        case 'model_selected':
          yield { type: 'model_selected', profile: event.profile, fallback: event.fallback };
          break;
        case 'text_delta':
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
    if (completed) yield { type: 'completed' };
  }
}
