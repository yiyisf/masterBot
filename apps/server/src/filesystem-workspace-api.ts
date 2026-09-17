import {
  createFilesystemWorkspaceRequestSchema,
  createGitWorktreeRequestSchema,
  filesystemWorkspacePageSchema,
  filesystemWorkspaceSchema,
  gitWorktreePageSchema,
  gitWorktreeSchema,
  problemDetailsSchema,
  uuidSchema,
  worktreeOperationSchema,
} from '@cmaster/contracts';
import type { IdentityModule } from '@cmaster/identity';
import {
  InvalidWorkspaceCursorError,
  InvalidWorkspaceNameError,
  InvalidWorkspacePageLimitError,
  InvalidGitBranchNameError,
  WorkspaceBranchConflictError,
  WorkspaceIdempotencyConflictError,
  WorkspaceLifecycleConflictError,
  WorkspaceNotFoundError,
  gitWorktreeId,
  workspaceCommandId,
  workspaceConnectorId,
  workspaceId,
  workspaceRepositoryId,
  type GitWorktree,
  type Workspace,
  type WorkspaceCatalog,
  type WorkspaceWorkingRoots,
} from '@cmaster/workspaces';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';

export interface FilesystemWorkspaceApiDependencies {
  readonly identity: IdentityModule;
  readonly catalog: WorkspaceCatalog;
  readonly workingRoots: WorkspaceWorkingRoots;
}

function workspaceContract(value: Workspace): unknown {
  return filesystemWorkspaceSchema.parse({
    id: value.id,
    name: value.name,
    source: value.source,
    operationMode: value.operationMode,
    lifecycleStatus: value.lifecycleStatus,
    defaultWorkingRoot: value.defaultWorkingRoot,
    ...(value.source.kind === 'git'
      ? { provisioningFailure: value.provisioningFailure ?? null }
      : {}),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  });
}

function gitWorktreeContract(value: GitWorktree): unknown {
  return gitWorktreeSchema.parse({
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  });
}

function problem(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  title: string,
  detail: string,
): FastifyReply {
  return reply.status(status).type('application/problem+json').send(problemDetailsSchema.parse({
    type: `https://cmaster.dev/problems/${code.replaceAll('_', '-')}`,
    title,
    status,
    code,
    detail,
    instance: request.url,
  }));
}

function sendError(error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error instanceof ZodError || error instanceof InvalidWorkspaceCursorError
    || error instanceof InvalidWorkspaceNameError
    || error instanceof InvalidWorkspacePageLimitError
    || error instanceof InvalidGitBranchNameError) {
    return problem(reply, request, 400, 'invalid_request', 'Invalid request',
      'The request does not match the API contract.');
  }
  if (error instanceof WorkspaceNotFoundError) {
    return problem(reply, request, 404, 'resource_not_found', 'Resource not found',
      'The requested resource was not found.');
  }
  if (error instanceof WorkspaceIdempotencyConflictError) {
    return problem(reply, request, 409, 'idempotency_conflict', 'Idempotency conflict',
      'The Idempotency-Key was already used for another command.');
  }
  if (error instanceof WorkspaceBranchConflictError
    || error instanceof WorkspaceLifecycleConflictError) {
    return problem(reply, request, 409, 'workspace_conflict', 'Workspace conflict',
      'The requested Worktree transition conflicts with current Workspace state.');
  }
  request.log.error({ requestId: request.id }, 'Filesystem Workspace API request failed');
  return problem(reply, request, 500, 'internal_error', 'Internal error',
    'The request could not be completed.');
}

function idempotencyKey(request: FastifyRequest): string {
  return uuidSchema.parse(request.headers['idempotency-key']);
}

export function registerFilesystemWorkspaceApi(
  app: FastifyInstance,
  dependencies: FilesystemWorkspaceApiDependencies,
): void {
  app.get('/api/v1/workspaces', async (request, reply) => {
    try {
      const query = z.object({
        cursor: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }).parse(request.query);
      const page = await dependencies.catalog.list(dependencies.identity.resolveRequest(), {
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      return reply.send(filesystemWorkspacePageSchema.parse({
        items: page.items.map(workspaceContract),
        nextCursor: page.nextCursor ?? null,
      }));
    } catch (error) {
      return sendError(error, request, reply);
    }
  });

  app.get('/api/v1/workspaces/by-command/:commandId', async (request, reply) => {
    try {
      const params = z.object({ commandId: uuidSchema }).parse(request.params);
      const value = await dependencies.catalog.getProvisionedByCommand(
        dependencies.identity.resolveRequest(), workspaceCommandId(params.commandId),
      );
      return reply.send(workspaceContract(value));
    } catch (error) {
      return sendError(error, request, reply);
    }
  });

  app.get('/api/v1/workspaces/:workspaceId/worktrees', async (request, reply) => {
    try {
      const params = z.object({ workspaceId: uuidSchema }).parse(request.params);
      const query = z.object({
        cursor: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }).parse(request.query);
      const page = await dependencies.workingRoots.listWorktrees(
        dependencies.identity.resolveRequest(),
        workspaceId(params.workspaceId),
        { limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}) },
      );
      return reply.send(gitWorktreePageSchema.parse({
        items: page.items.map(gitWorktreeContract),
        nextCursor: page.nextCursor ?? null,
      }));
    } catch (error) {
      return sendError(error, request, reply);
    }
  });

  app.post('/api/v1/workspaces/:workspaceId/worktrees', async (request, reply) => {
    try {
      const params = z.object({ workspaceId: uuidSchema }).parse(request.params);
      const body = createGitWorktreeRequestSchema.parse(request.body);
      const result = await dependencies.workingRoots.createWorktree(
        dependencies.identity.resolveRequest(),
        workspaceId(params.workspaceId),
        { commandId: workspaceCommandId(idempotencyKey(request)), branchName: body.branchName },
      );
      reply.header('Idempotency-Replayed', String(result.replayed));
      return reply.status(202).send(worktreeOperationSchema.parse(result.value));
    } catch (error) {
      return sendError(error, request, reply);
    }
  });

  app.get('/api/v1/workspaces/:workspaceId/worktree-commands/:commandId', async (request, reply) => {
    try {
      const params = z.object({ workspaceId: uuidSchema, commandId: uuidSchema })
        .parse(request.params);
      const operation = await dependencies.workingRoots.getWorktreeOperationByCommand(
        dependencies.identity.resolveRequest(),
        workspaceId(params.workspaceId),
        workspaceCommandId(params.commandId),
      );
      return reply.send(worktreeOperationSchema.parse(operation));
    } catch (error) {
      return sendError(error, request, reply);
    }
  });

  app.post('/api/v1/workspaces/:workspaceId/worktrees/:worktreeId/archive', async (request, reply) => {
    try {
      const params = z.object({ workspaceId: uuidSchema, worktreeId: uuidSchema })
        .parse(request.params);
      const result = await dependencies.workingRoots.archiveWorktree(
        dependencies.identity.resolveRequest(),
        workspaceId(params.workspaceId),
        gitWorktreeId(params.worktreeId),
        { commandId: workspaceCommandId(idempotencyKey(request)) },
      );
      reply.header('Idempotency-Replayed', String(result.replayed));
      return reply.send(gitWorktreeContract(result.value));
    } catch (error) {
      return sendError(error, request, reply);
    }
  });

  app.get('/api/v1/workspaces/:workspaceId/worktrees/:worktreeId/lifecycle-commands/:commandId', async (request, reply) => {
    try {
      const params = z.object({
        workspaceId: uuidSchema, worktreeId: uuidSchema, commandId: uuidSchema,
      }).parse(request.params);
      const worktree = await dependencies.workingRoots.getWorktreeLifecycleByCommand(
        dependencies.identity.resolveRequest(),
        workspaceId(params.workspaceId),
        gitWorktreeId(params.worktreeId),
        workspaceCommandId(params.commandId),
      );
      return reply.send(gitWorktreeContract(worktree));
    } catch (error) {
      return sendError(error, request, reply);
    }
  });

  app.get('/api/v1/workspaces/:workspaceId/lifecycle-commands/:commandId', async (request, reply) => {
    try {
      const params = z.object({ workspaceId: uuidSchema, commandId: uuidSchema })
        .parse(request.params);
      const value = await dependencies.catalog.getLifecycleByCommand(
        dependencies.identity.resolveRequest(),
        workspaceId(params.workspaceId),
        workspaceCommandId(params.commandId),
      );
      return reply.send(workspaceContract(value));
    } catch (error) {
      return sendError(error, request, reply);
    }
  });

  app.get('/api/v1/workspaces/:workspaceId', async (request, reply) => {
    try {
      const params = z.object({ workspaceId: uuidSchema }).parse(request.params);
      const value = await dependencies.catalog.get(
        dependencies.identity.resolveRequest(), workspaceId(params.workspaceId),
      );
      return reply.send(workspaceContract(value));
    } catch (error) {
      return sendError(error, request, reply);
    }
  });

  for (const [action, targetStatus] of [
    ['archive', 'archived'], ['restore', 'ready'],
  ] as const) {
    app.post(`/api/v1/workspaces/:workspaceId/${action}`, async (request, reply) => {
      try {
        const params = z.object({ workspaceId: uuidSchema }).parse(request.params);
        const result = await dependencies.catalog.transitionLifecycle(
          dependencies.identity.resolveRequest(),
          workspaceId(params.workspaceId),
          {
            commandId: workspaceCommandId(idempotencyKey(request)),
            targetStatus,
          },
        );
        reply.header('Idempotency-Replayed', String(result.replayed));
        return reply.send(workspaceContract(result.value));
      } catch (error) {
        return sendError(error, request, reply);
      }
    });
  }

  app.post('/api/v1/workspaces', async (request, reply) => {
    try {
      const body = createFilesystemWorkspaceRequestSchema.parse(request.body);
      const commandId = workspaceCommandId(idempotencyKey(request));
      const requestIdentity = dependencies.identity.resolveRequest();
      const result = body.source?.kind === 'git'
        ? await dependencies.catalog.provisionGit(requestIdentity, {
          commandId,
          name: body.name,
          operationMode: body.operationMode,
          source: {
            connectorId: workspaceConnectorId(body.source.connectorId),
            repositoryId: workspaceRepositoryId(body.source.repositoryId),
            defaultBranch: body.source.defaultBranch,
          },
        })
        : await dependencies.catalog.provisionEmpty(requestIdentity, {
          commandId,
          name: body.name,
          operationMode: body.operationMode,
        });
      reply.header('Idempotency-Replayed', String(result.replayed));
      return reply.status(201).send(workspaceContract(result.value));
    } catch (error) {
      return sendError(error, request, reply);
    }
  });
}
