import {
  workspaceConversationPageSchema,
  workspaceSummarySchema,
} from '@cmaster/contracts';
import type { ConversationModule } from '@cmaster/conversations';
import type { ExecutionModule } from '@cmaster/execution';
import type { IdentityModule } from '@cmaster/identity';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendRunApiError } from './run-api.js';

export interface WorkspaceApiDependencies {
  readonly identity: IdentityModule;
  readonly conversations: Pick<ConversationModule, 'list' | 'count'>;
  readonly execution: Pick<
    ExecutionModule,
    'listConversationActivity' | 'summarizePrincipalActivity'
  >;
}

/**
 * 只组合 Module 公开查询，不拥有持久化或授权规则。每次请求只执行有界查询；
 * trusted identity 由 Server 提供，Browser 不能声明 Organization 或 Principal。
 */
export function registerWorkspaceApi(
  app: FastifyInstance,
  dependencies: WorkspaceApiDependencies,
): void {
  app.get('/api/v1/workspace/summary', async (request, reply) => {
    try {
      const identity = dependencies.identity.resolveRequest();
      const [conversationCount, activity] = await Promise.all([
        dependencies.conversations.count(identity),
        dependencies.execution.summarizePrincipalActivity(identity),
      ]);
      return reply.send(workspaceSummarySchema.parse({ conversationCount, ...activity }));
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });

  app.get('/api/v1/workspace/conversations', async (request, reply) => {
    try {
      const query = z.object({
        cursor: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }).parse(request.query);
      const identity = dependencies.identity.resolveRequest();
      const page = await dependencies.conversations.list(identity, {
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      const activity = await dependencies.execution.listConversationActivity(
        identity,
        page.items.map((item) => item.id),
      );
      const activityByConversation = new Map(
        activity.map((item) => [item.conversationId, item]),
      );
      return reply.send(workspaceConversationPageSchema.parse({
        items: page.items.map((item) => {
          const runActivity = activityByConversation.get(item.id);
          return {
            id: item.id,
            title: item.title ?? null,
            preview: item.preview,
            updatedAt: item.updatedAt.toISOString(),
            activity: {
              activeRunCount: runActivity?.activeRunCount ?? 0,
              pendingActionCount: runActivity?.pendingActionCount ?? 0,
              ...(runActivity?.latestRunStatus
                ? { latestRunStatus: runActivity.latestRunStatus }
                : {}),
            },
          };
        }),
        nextCursor: page.nextCursor ?? null,
      }));
    } catch (error) {
      return sendRunApiError(error, request, reply);
    }
  });
}
