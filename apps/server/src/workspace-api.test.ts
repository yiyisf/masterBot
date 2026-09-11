import { conversationId, type ConversationModule } from '@cmaster/conversations';
import { interruptId, runId, type ExecutionModule } from '@cmaster/execution';
import { type ApprovalModule } from '@cmaster/governance';
import { organizationId, principalId, type IdentityModule } from '@cmaster/identity';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerWorkspaceApi } from './workspace-api.js';

const requestIdentity = {
  organizationId: organizationId('00000000-0000-4000-8000-000000000001'),
  principalId: principalId('00000000-0000-4000-8000-000000000002'),
  principalType: 'employee' as const,
  displayName: 'Employee',
};
const identity: IdentityModule = {
  async provision() {},
  resolveRequest: () => requestIdentity,
};

function dependencies() {
  const conversations = {
    async list(resolvedIdentity: typeof requestIdentity, query: { cursor?: string; limit: number }) {
      expect(resolvedIdentity).toBe(requestIdentity);
      expect(query).toEqual({ limit: 20 });
      return {
        items: [{
          id: conversationId('00000000-0000-4000-8000-000000000101'),
          title: 'Planning',
          preview: { kind: 'artifact' as const },
          updatedAt: new Date('2026-09-08T12:00:00.000Z'),
        }],
      };
    },
    async count() { return 1; },
  } satisfies Pick<ConversationModule, 'list' | 'count'>;
  const execution = {
    async listConversationActivity() {
      return [{
        conversationId: conversationId('00000000-0000-4000-8000-000000000101'),
        activeRunCount: 1,
        pendingActionCount: 1,
        latestRunStatus: 'waiting' as const,
      }];
    },
    async summarizePrincipalActivity() {
      return { activeRunCount: 1, pendingActionCount: 1 };
    },
    async listActiveInterrupts() {
      return { items: [{
        runId: runId('00000000-0000-4000-8000-000000000102'),
        conversationId: conversationId('00000000-0000-4000-8000-000000000101'),
        triggerMessageId: '00000000-0000-4000-8000-000000000103' as never,
        interrupt: {
          id: interruptId('00000000-0000-4000-8000-000000000104'),
          kind: 'tool_confirmation' as const,
          status: 'pending' as const,
          subjectRef: 'tool-call-private-ref',
          safeSubjectSummary: { title: 'Stale duplicate summary', details: {} },
          allowedResponses: ['confirm', 'reject'] as const,
        },
        createdAt: new Date('2026-09-08T12:01:00.000Z'),
      }] };
    },
  } satisfies Pick<ExecutionModule,
    'listConversationActivity' | 'summarizePrincipalActivity' | 'listActiveInterrupts'>;
  const approvals = {
    async listBySubjectRefs() {
      return [{
        id: '00000000-0000-4000-8000-000000000105' as never,
        organizationId: requestIdentity.organizationId,
        initiatingPrincipalId: requestIdentity.principalId,
        subject: {
          kind: 'tool_call' as const,
          subjectRef: 'tool-call-private-ref',
          toolRevisionRef: 'private-revision',
          requestHash: 'private-request-hash',
          safeSummary: { title: 'Fetch documentation', details: { host: 'docs.example.test' } },
        },
        policyVersion: 'slice3-baseline-v1',
        status: 'pending' as const,
        createdAt: new Date('2026-09-08T12:00:00.000Z'),
      }];
    },
  } satisfies Pick<ApprovalModule, 'listBySubjectRefs'>;
  return { identity, conversations, execution, approvals };
}

describe('Workspace Experience API', () => {
  it('composes private Module projections without reading persistence', async () => {
    const app = Fastify();
    registerWorkspaceApi(app, dependencies());

    const response = await app.inject({ method: 'GET', url: '/api/v1/workspace/conversations' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [{
        id: '00000000-0000-4000-8000-000000000101',
        title: 'Planning',
        preview: { kind: 'artifact' },
        updatedAt: '2026-09-08T12:00:00.000Z',
        activity: { activeRunCount: 1, pendingActionCount: 1, latestRunStatus: 'waiting' },
      }],
      nextCursor: null,
    });
    await app.close();
  });

  it('projects active Confirmation from its immutable Approval Subject without private fields', async () => {
    const app = Fastify();
    registerWorkspaceApi(app, dependencies());
    const response = await app.inject({ method: 'GET', url: '/api/v1/workspace/interrupts?limit=20' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      items: [{
        kind: 'employee_confirmation',
        conversationId: '00000000-0000-4000-8000-000000000101',
        triggerMessageId: '00000000-0000-4000-8000-000000000103',
        runId: '00000000-0000-4000-8000-000000000102',
        interruptId: '00000000-0000-4000-8000-000000000104',
        createdAt: '2026-09-08T12:01:00.000Z',
        decisionStatus: 'pending',
        allowedResponses: ['confirm', 'reject'],
        approvalSubject: {
          approvalId: '00000000-0000-4000-8000-000000000105',
          title: 'Fetch documentation',
          details: { host: 'docs.example.test' },
        },
      }],
      nextCursor: null,
    });
    expect(response.body).not.toContain('tool-call-private-ref');
    expect(response.body).not.toContain('private-request-hash');
    expect(response.body).not.toContain('private-revision');
    await app.close();
  });

  it('returns bounded home counts', async () => {
    const app = Fastify();
    registerWorkspaceApi(app, dependencies());
    const response = await app.inject({ method: 'GET', url: '/api/v1/workspace/summary' });
    expect(response.json()).toEqual({
      conversationCount: 1,
      activeRunCount: 1,
      pendingActionCount: 1,
    });
    await app.close();
  });
});
