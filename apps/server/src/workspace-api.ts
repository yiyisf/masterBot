import {
  pendingInterruptPageSchema,
  workspaceConversationPageSchema,
  workspaceSummarySchema,
} from '@cmaster/contracts';
import type { ConversationModule } from '@cmaster/conversations';
import type { ExecutionModule } from '@cmaster/execution';
import type { ApprovalModule } from '@cmaster/governance';
import type { IdentityModule } from '@cmaster/identity';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendRunApiError } from './run-api.js';

export interface WorkspaceApiDependencies {
  readonly identity: IdentityModule;
  readonly conversations: Pick<ConversationModule, 'list' | 'count'>;
  readonly execution: Pick<
    ExecutionModule,
    'listConversationActivity' | 'summarizePrincipalActivity' | 'listActiveInterrupts'
  >;
  readonly approvals: Pick<ApprovalModule, 'listBySubjectRefs'>;
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

  app.get('/api/v1/workspace/interrupts', async (request, reply) => {
    try {
      const query = z.object({
        cursor: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }).parse(request.query);
      const identity = dependencies.identity.resolveRequest();
      const page = await dependencies.execution.listActiveInterrupts(identity, {
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      const confirmationRefs = page.items
        .filter((item) => item.interrupt.kind === 'tool_confirmation')
        .map((item) => item.interrupt.subjectRef);
      const approvals = await dependencies.approvals.listBySubjectRefs(identity, confirmationRefs);
      const approvalBySubjectRef = new Map(
        approvals.map((approval) => [approval.subject.subjectRef, approval]),
      );
      const items = page.items.map((item) => {
        const common = {
          conversationId: item.conversationId,
          triggerMessageId: item.triggerMessageId,
          runId: item.runId,
          interruptId: item.interrupt.id,
          createdAt: item.createdAt.toISOString(),
        };
        if (item.interrupt.kind === 'tool_confirmation') {
          const approval = approvalBySubjectRef.get(item.interrupt.subjectRef);
          if (!approval) throw new Error('Active Confirmation has no immutable Approval Subject');
          return {
            ...common,
            kind: 'employee_confirmation' as const,
            decisionStatus: approval.status,
            allowedResponses: approval.status === 'pending'
              ? item.interrupt.allowedResponses.filter(
                  (response): response is 'confirm' | 'reject' => (
                    response === 'confirm' || response === 'reject'
                  ),
                )
              : [],
            approvalSubject: {
              approvalId: approval.id,
              title: approval.subject.safeSummary.title,
              details: approval.subject.safeSummary.details,
            },
          };
        }
        return {
          ...common,
          kind: 'uncertain_tool_outcome_review' as const,
          allowedResponses: item.interrupt.allowedResponses.filter(
            (response): response is 'continue_with_uncertainty' => (
              response === 'continue_with_uncertainty'
            ),
          ),
          subject: item.interrupt.safeSubjectSummary,
        };
      });
      return reply.send(pendingInterruptPageSchema.parse({
        items,
        nextCursor: page.nextCursor ?? null,
      }));
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
