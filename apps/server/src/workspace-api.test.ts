import { conversationId, type ConversationModule } from '@cmaster/conversations';
import type { ExecutionModule } from '@cmaster/execution';
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
  } satisfies Pick<ExecutionModule, 'listConversationActivity' | 'summarizePrincipalActivity'>;
  return { identity, conversations, execution };
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
