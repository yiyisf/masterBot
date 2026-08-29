import type { InvocationId } from './types.js';

export interface EngineInvocation {
  invocationId: InvocationId;
  prompt: string;
}

export type EngineEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'completed' };

export interface AgentEngine {
  readonly kind: string;
  readonly version: string;
  execute(input: EngineInvocation, signal: AbortSignal): AsyncIterable<EngineEvent>;
}

export class EchoAgentEngine implements AgentEngine {
  readonly kind = 'echo';
  readonly version = '1';

  async *execute(input: EngineInvocation, signal: AbortSignal): AsyncIterable<EngineEvent> {
    if (signal.aborted) return;
    yield { type: 'text_delta', text: input.prompt };
    if (signal.aborted) return;
    yield { type: 'completed' };
  }
}
