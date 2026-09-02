import type { AgentRevisionId } from '@cmaster/agents';
import type { OrganizationId } from '@cmaster/identity';
import type {
  ModelGateway,
  ModelInvocationRequest,
  ModelProfileId,
  ModelSelection,
} from '@cmaster/models';
import { describe, expect, it } from 'vitest';
import { AiSdkAgentEngine, EchoAgentEngine, type EngineInvocation } from './engine.js';
import type { InvocationId, RunId } from './types.js';

const invocation: EngineInvocation = {
  organizationId: '00000000-0000-4000-8000-000000000001' as OrganizationId,
  runId: '00000000-0000-4000-8000-000000000002' as RunId,
  invocationId: '00000000-0000-4000-8000-000000000003' as InvocationId,
  agentRevisionId: '00000000-0000-4000-8000-000000000004' as AgentRevisionId,
  prompt: 'hello',
};

const selection: ModelSelection = {
  id: '00000000-0000-4000-8000-000000000005' as ModelProfileId,
  displayName: 'Test Model',
};

class ToolLoopModelGateway implements ModelGateway {
  readonly requests: ModelInvocationRequest[] = [];

  async provision(): Promise<void> {}
  async listCalls(): Promise<[]> { return []; }

  async *stream(request: ModelInvocationRequest) {
    this.requests.push(request);
    yield { type: 'model_selected' as const, callId: 'call-1' as never, profile: selection, fallback: false };
    if (this.requests.length === 1) {
      yield {
        type: 'model_completed' as const,
        callId: 'call-1' as never,
        profile: selection,
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        fallbackUsed: false,
      };
      yield {
        type: 'tool_requested' as const,
        request: { requestId: 'provider-call-1', name: 'current_time', input: {} },
      };
      return;
    }
    yield { type: 'text_delta' as const, text: 'It is noon.' };
    yield {
      type: 'model_completed' as const,
      callId: 'call-2' as never,
      profile: selection,
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      fallbackUsed: false,
    };
  }
}

describe('EchoAgentEngine', () => {
  it('returns the employee input unchanged', async () => {
    const events = [];
    for await (const event of new EchoAgentEngine().execute(
      invocation,
      new AbortController().signal,
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: 'text_delta', text: 'hello' },
      { type: 'completed' },
    ]);
  });
});

describe('AiSdkAgentEngine Tool Loop', () => {
  it('executes one governed Tool request and sends its outcome as a Tool Message', async () => {
    const models = new ToolLoopModelGateway();
    const invoked: string[] = [];
    const engine = new AiSdkAgentEngine(models, {
      async list() {
        return [{
          name: 'current_time',
          description: 'Returns the current time.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          outputSchema: { type: 'object' },
        }];
      },
      async invoke(_input, request) {
        invoked.push(request.requestId);
        return {
          kind: 'completed',
          toolCallId: 'tool-call-1',
          modelOutput: { iso: '2026-01-02T12:00:00Z' },
        };
      },
      async recover() {
        throw new Error('not expected');
      },
    });
    const events = [];
    for await (const event of engine.execute(invocation, new AbortController().signal)) {
      events.push(event);
    }

    expect(invoked).toEqual(['provider-call-1']);
    expect(models.requests).toHaveLength(2);
    expect(models.requests[1]?.transcript).toEqual([
      { role: 'user', text: 'hello' },
      {
        role: 'assistant',
        text: '',
        toolRequests: [{ requestId: 'provider-call-1', name: 'current_time', input: {} }],
      },
      {
        role: 'tool',
        requestId: 'provider-call-1',
        name: 'current_time',
        output: { iso: '2026-01-02T12:00:00Z' },
      },
    ]);
    expect(events.at(-2)).toEqual({
      type: 'model_completed',
      profile: selection,
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      fallbackUsed: false,
    });
    expect(events.at(-1)).toEqual({ type: 'completed' });
  });
});

describe('AiSdkAgentEngine interrupt recovery', () => {
  it('resumes from the confirmed ToolCall without regenerating its Model Tool Request', async () => {
    const models = new ToolLoopModelGateway();
    let invokeCount = 0;
    let recoverCount = 0;
    const tools = {
      async list() {
        return [{
          name: 'current_time',
          description: 'Returns the current time.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          outputSchema: { type: 'object' },
        }];
      },
      async invoke() {
        invokeCount += 1;
        return {
          kind: 'interrupt' as const,
          interruptKind: 'tool_confirmation' as const,
          toolCallId: 'tool-call-confirm',
          safeSummary: { title: 'Confirm Tool', details: { operation: 'current time' } },
        };
      },
      async recover() {
        recoverCount += 1;
        return {
          kind: 'completed' as const,
          toolCallId: 'tool-call-confirm',
          modelOutput: { iso: '2026-01-02T12:00:00Z' },
        };
      },
    };
    const firstEvents = [];
    for await (const event of new AiSdkAgentEngine(models, tools).execute(
      invocation, new AbortController().signal,
    )) firstEvents.push(event);
    const interrupt = firstEvents.at(-1);
    expect(interrupt).toMatchObject({
      type: 'interrupt_requested',
      kind: 'tool_confirmation',
      subjectRef: 'tool-call-confirm',
    });
    if (!interrupt || interrupt.type !== 'interrupt_requested') throw new Error('Interrupt expected');

    const resumedEvents = [];
    for await (const event of new AiSdkAgentEngine(models, tools).execute({
      ...invocation,
      checkpoint: interrupt.checkpoint,
      resumeResponse: 'confirm',
    }, new AbortController().signal)) resumedEvents.push(event);

    expect(invokeCount).toBe(1);
    expect(recoverCount).toBe(1);
    expect(models.requests).toHaveLength(2);
    expect(models.requests[1]?.transcript?.at(-1)).toEqual({
      role: 'tool',
      requestId: 'provider-call-1',
      name: 'current_time',
      output: { iso: '2026-01-02T12:00:00Z' },
    });
    expect(resumedEvents.at(-1)).toEqual({ type: 'completed' });
  });
});
