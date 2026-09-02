import { agentId, agentRevisionId } from '@cmaster/agents';
import { conversationId, messageId } from '@cmaster/conversations';
import {
  runId,
  type ActiveInterrupt,
  type ExecutionModule,
  type RunSnapshot,
} from '@cmaster/execution';
import { organizationId, principalId, type RequestIdentity } from '@cmaster/identity';
import { modelProfileId } from '@cmaster/models';
import { type ToolCallId, type ToolRuntime } from '@cmaster/tools';
import { describe, expect, it, vi } from 'vitest';
import {
  Slice3DevelopmentEntitlements,
  ToolConfirmationConflictError,
  ToolConfirmationCoordinator,
} from './tool-confirmation-coordinator.js';

const identity: RequestIdentity = {
  organizationId: organizationId('00000000-0000-4000-8000-000000000001'),
  principalId: principalId('00000000-0000-4000-8000-000000000002'),
  principalType: 'employee',
  displayName: 'Initiating Employee',
};
const activeInterrupt: ActiveInterrupt = {
  id: '00000000-0000-4000-8000-000000000010' as ActiveInterrupt['id'],
  kind: 'tool_confirmation',
  status: 'pending',
  subjectRef: '00000000-0000-4000-8000-000000000011',
  safeSubjectSummary: { title: 'Fetch approved content', details: { host: 'docs.example.test' } },
  allowedResponses: ['confirm', 'reject'],
};

function snapshot(status: RunSnapshot['status'], interrupt?: ActiveInterrupt): RunSnapshot {
  return {
    id: runId('00000000-0000-4000-8000-000000000020'),
    organizationId: identity.organizationId,
    initiatingPrincipalId: identity.principalId,
    conversationId: conversationId('00000000-0000-4000-8000-000000000021'),
    trigger: { type: 'message', messageId: messageId('00000000-0000-4000-8000-000000000022') },
    agentId: agentId('00000000-0000-4000-8000-000000000023'),
    agentRevisionId: agentRevisionId('00000000-0000-4000-8000-000000000024'),
    engine: { kind: 'ai-sdk', version: '1' },
    rootInvocation: {
      id: '00000000-0000-4000-8000-000000000025' as RunSnapshot['rootInvocation']['id'],
      status: status === 'waiting' ? 'interrupted' : 'pending',
    },
    status,
    cancellable: true,
    lastSequence: 1,
    model: {
      profileId: modelProfileId('00000000-0000-4000-8000-000000000026'),
      displayName: 'Test',
      fallbackUsed: false,
    },
    ...(interrupt ? { activeInterrupt: interrupt } : {}),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
}

describe('ToolConfirmationCoordinator', () => {
  it('resumes the exact ToolCall before resolving its durable Interrupt', async () => {
    const order: string[] = [];
    const waiting = snapshot('waiting', activeInterrupt);
    const resumed = snapshot('queued');
    const tools = {
      resume: vi.fn(async () => {
        order.push('tool');
        return {
          kind: 'denied' as const,
          toolCallId: activeInterrupt.subjectRef as ToolCallId,
          reason: 'employee_rejected' as const,
        };
      }),
    } satisfies Pick<ToolRuntime, 'resume'>;
    const execution = {
      getRun: vi.fn(async () => waiting),
      getInterrupt: vi.fn(async () => activeInterrupt),
      enterToolBoundary: vi.fn(async () => { order.push('enter'); }),
      leaveToolBoundary: vi.fn(async () => { order.push('leave'); }),
      resolveInterrupt: vi.fn(async () => {
        order.push('interrupt');
        return { value: resumed, replayed: false };
      }),
    } satisfies Pick<
      ExecutionModule,
      'getRun' | 'getInterrupt' | 'resolveInterrupt' | 'enterToolBoundary' | 'leaveToolBoundary'
    >;
    const coordinator = new ToolConfirmationCoordinator(
      execution, tools, new Slice3DevelopmentEntitlements(),
    );

    const result = await coordinator.resolve(
      identity, waiting.id, activeInterrupt.id, {
        commandId: '00000000-0000-4000-8000-000000000030',
        response: 'reject',
        signal: new AbortController().signal,
      },
    );

    expect(order).toEqual(['enter', 'tool', 'leave', 'interrupt']);
    expect(result).toMatchObject({ run: { status: 'queued' }, outcome: { kind: 'denied' } });
    expect(tools.resume).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: activeInterrupt.subjectRef,
      principalEntitlements: ['enterprise_assistant.use_governed_tools'],
      response: 'reject',
    }));
  });

  it('does not resolve a non-confirmation Interrupt', async () => {
    const waiting = snapshot('waiting', { ...activeInterrupt, kind: 'tool_outcome_review' });
    const coordinator = new ToolConfirmationCoordinator(
      {
        getRun: vi.fn(async () => waiting),
        getInterrupt: vi.fn(async () => ({ ...activeInterrupt, kind: 'tool_outcome_review' as const })),
        enterToolBoundary: vi.fn(),
        leaveToolBoundary: vi.fn(),
        resolveInterrupt: vi.fn(),
      },
      { resume: vi.fn() },
      new Slice3DevelopmentEntitlements(),
    );
    await expect(coordinator.resolve(
      identity, waiting.id, activeInterrupt.id, {
        commandId: '00000000-0000-4000-8000-000000000031',
        response: 'confirm', signal: new AbortController().signal,
      },
    )).rejects.toBeInstanceOf(ToolConfirmationConflictError);
  });
});
