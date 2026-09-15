import { systemStatusSchema } from '@cmaster/contracts';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRunUiPresenter } from './run-ui-presenter.js';
import {
  registerFilesystemWorkspaceApi,
  type FilesystemWorkspaceApiDependencies,
} from './filesystem-workspace-api.js';
import { registerArtifactApi, type ArtifactApiDependencies } from './artifact-api.js';
import type { ServerConfig } from './config.js';
import { EnvironmentFeatureFlags, type FeatureFlags } from './feature-flags.js';
import type { DatabaseHealth } from './postgres.js';
import type { ToolConfirmationCoordinator } from './tool-confirmation-coordinator.js';
import { registerRunApi, type RunApiDependencies } from './run-api.js';
import { registerWorkspaceApi, type WorkspaceApiDependencies } from './workspace-api.js';

export interface ApiDependencies {
  config: ServerConfig;
  database: DatabaseHealth;
  featureFlags?: FeatureFlags;
  runApi?: RunApiDependencies;
  artifactApi?: ArtifactApiDependencies;
  workspaceApi?: WorkspaceApiDependencies;
  filesystemWorkspaceApi?: FilesystemWorkspaceApiDependencies;
  toolConfirmationCoordinator?: ToolConfirmationCoordinator;
}

export function buildApi(dependencies: ApiDependencies): FastifyInstance {
  const app = Fastify({ logger: dependencies.config.runtimeEnvironment !== 'test' });
  const featureFlags = dependencies.featureFlags ?? new EnvironmentFeatureFlags({
    nextArchitecture: dependencies.config.features.nextArchitecture,
    toolRuntime: dependencies.config.features.toolRuntime,
    contextArtifacts: dependencies.config.features.contextArtifacts,
    employeeWorkspace: dependencies.config.features.employeeWorkspace,
    filesystemWorkspace: dependencies.config.features.filesystemWorkspace,
  });

  if (featureFlags.isEnabled('toolRuntime') && !dependencies.toolConfirmationCoordinator) {
    throw new Error('Tool Runtime requires a Tool Confirmation Coordinator');
  }
  if (featureFlags.isEnabled('contextArtifacts') && !dependencies.artifactApi) {
    throw new Error('Context and Artifacts require an Artifact API');
  }
  if (featureFlags.isEnabled('employeeWorkspace') && !dependencies.workspaceApi) {
    throw new Error('Employee Workspace requires a Workspace API');
  }
  if (featureFlags.isEnabled('filesystemWorkspace') && !dependencies.filesystemWorkspaceApi) {
    throw new Error('Filesystem Workspace requires a Workspace Catalog API');
  }

  void app.register(cors, {
    origin: dependencies.config.webOrigin,
    credentials: true,
  });

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    const available = await dependencies.database.check();
    if (!available) reply.status(503);
    return { status: available ? 'ready' : 'not-ready' };
  });

  if (featureFlags.isEnabled('nextArchitecture')) {
    if (featureFlags.isEnabled('contextArtifacts') && dependencies.artifactApi) {
      registerArtifactApi(app, dependencies.artifactApi);
    }
    if (featureFlags.isEnabled('employeeWorkspace') && dependencies.workspaceApi) {
      registerWorkspaceApi(app, dependencies.workspaceApi);
    }
    if (featureFlags.isEnabled('filesystemWorkspace') && dependencies.filesystemWorkspaceApi) {
      registerFilesystemWorkspaceApi(app, dependencies.filesystemWorkspaceApi);
    }
    if (dependencies.runApi) {
      registerRunApi(app, {
        ...dependencies.runApi,
        ...(featureFlags.isEnabled('toolRuntime') && dependencies.toolConfirmationCoordinator
          ? { toolConfirmation: dependencies.toolConfirmationCoordinator }
          : {}),
      });
      if (featureFlags.isEnabled('employeeWorkspace')) {
        registerRunUiPresenter(app, dependencies.runApi);
      }
    }

    app.get('/api/v1/system/status', async () => {
      const postgresAvailable = await dependencies.database.check();
      return systemStatusSchema.parse({
        contractVersion: 'v1',
        service: 'cmaster-next',
        role: dependencies.config.role,
        status: postgresAvailable ? 'ok' : 'degraded',
        postgres: postgresAvailable ? 'available' : 'unavailable',
        nextArchitectureEnabled: true,
      });
    });
  }

  return app;
}
