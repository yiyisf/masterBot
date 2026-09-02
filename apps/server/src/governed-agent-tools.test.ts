import type { AgentRevisionId } from '@cmaster/agents';
import type { EngineInvocation } from '@cmaster/execution';
import type { OrganizationId, PrincipalId, RequestIdentity } from '@cmaster/identity';
import type { InvocationId, RunId } from '@cmaster/execution';
import {
  toolGrantId,
  toolRevisionId,
  type ToolCall,
  type ToolDescriptor,
  type ToolOutcome,
} from '@cmaster/tools';
import { describe, expect, it } from 'vitest';
import {
  GovernedAgentToolRuntime,
  GovernedToolAuthorizationError,
} from './governed-agent-tools.js';

const identity: RequestIdentity = {
  organizationId: '00000000-0000-4000-8000-000000000001' as OrganizationId,
  principalId: '00000000-0000-4000-8000-000000000002' as PrincipalId,
  principalType: 'employee',
  displayName: 'Employee',
};

const invocation: EngineInvocation = {
  organizationId: identity.organizationId,
  runId: '00000000-0000-4000-8000-000000000003' as RunId,
  invocationId: '00000000-0000-4000-8000-000000000004' as InvocationId,
  agentRevisionId: '00000000-0000-4000-8000-000000000005' as AgentRevisionId,
  prompt: 'use a tool',
};

const descriptor: ToolDescriptor = {
  revisionId: toolRevisionId('00000000-0000-4000-8000-000000000006'),
  capabilityId: 'cmaster.utility.current_time:v1',
  name: 'current_time',
  description: 'Returns the current time.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: { type: 'object' },
  effect: 'read_only',
  recovery: 'retry_same_call',
  risks: [],
};

function fixture(outcome: ToolOutcome) {
  let invokes = 0;
  const runtime = new GovernedAgentToolRuntime(
    { async list() { return [descriptor]; } },
    {
      async invoke() { invokes += 1; return outcome; },
      async listCalls() { return []; },
    },
    { resolveRequest() { return identity; } },
    { async resolve() { return ['enterprise_assistant.use_governed_tools']; } },
    toolGrantId('00000000-0000-4000-8000-000000000007'),
    { async enterToolBoundary() {}, async leaveToolBoundary() {} },
  );
  return { runtime, invokeCount: () => invokes };
}

describe('GovernedAgentToolRuntime', () => {
  it('resolves model names only through the active Agent Tool Grant', async () => {
    const success = {
      kind: 'success',
      toolCallId: '00000000-0000-4000-8000-000000000008',
      value: { iso: '2026-01-02T12:00:00Z' },
      safeSummary: { title: 'Current time', details: {} },
    } as ToolOutcome;
    const { runtime, invokeCount } = fixture(success);

    await expect(runtime.invoke(
      invocation,
      { requestId: 'invented-1', name: 'invented_tool', input: {} },
      new AbortController().signal,
    )).rejects.toBeInstanceOf(GovernedToolAuthorizationError);
    expect(invokeCount()).toBe(0);

    await expect(runtime.invoke(
      invocation,
      { requestId: 'provider-1', name: 'current_time', input: {} },
      new AbortController().signal,
    )).resolves.toMatchObject({
      kind: 'completed',
      modelOutput: { iso: '2026-01-02T12:00:00Z' },
    });
    expect(invokeCount()).toBe(1);
  });

  it('projects a durable unknown Tool outcome into an outcome-review Interrupt', async () => {
    const callId = '00000000-0000-4000-8000-000000000008' as ToolCall['id'];
    const call: ToolCall = {
      id: callId,
      organizationId: identity.organizationId,
      runId: invocation.runId,
      invocationId: invocation.invocationId,
      capabilityId: descriptor.capabilityId,
      revisionId: descriptor.revisionId,
      status: 'requires_review',
      idempotencyKey: 'stable-key',
      requestHash: 'hash',
      requestSummary: { title: 'Current time', details: {} },
      outcome: {
        kind: 'requires_review',
        toolCallId: callId,
        failure: {
          code: 'external_effect_unknown',
          message: 'The external effect is unknown.',
          retryable: false,
        },
      },
    };
    const runtime = new GovernedAgentToolRuntime(
      { async list() { return [descriptor]; } },
      { async invoke() { throw new Error('not expected'); }, async listCalls() { return [call]; } },
      { resolveRequest() { return identity; } },
      { async resolve() { return []; } },
      toolGrantId('00000000-0000-4000-8000-000000000007'),
      { async enterToolBoundary() {}, async leaveToolBoundary() {} },
    );

    await expect(runtime.recover(
      invocation,
      call.id,
      { requestId: 'provider-1', name: 'current_time', input: {} },
    )).resolves.toMatchObject({
      kind: 'interrupt',
      interruptKind: 'tool_outcome_review',
      toolCallId: call.id,
    });
  });
});
