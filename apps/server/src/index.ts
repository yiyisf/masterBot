import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import { PostgresConversationModule } from '@cmaster/conversations';
import {
  AiSdkAgentEngine,
  EchoAgentEngine,
  PostgresExecutionModule,
  RunWorker,
  type AgentEngine,
} from '@cmaster/execution';
import {
  PostgresApprovalModule,
  Slice3BaselinePolicy,
} from '@cmaster/governance';
import {
  CurrentTimeToolProvider,
  HttpsFetchToolProvider,
  PostgresToolCatalog,
  PostgresToolRuntime,
  TextStatisticsToolProvider,
  WORKFLOW_VALIDATION_TOOL_GRANT_ID,
  workflowValidationToolCatalog,
} from '@cmaster/tools';
import {
  modelProfileId,
  OpenAICompatibleModelAdapter,
  PostgresModelGateway,
  type ModelGateway,
  type ModelProfileProvisioning,
} from '@cmaster/models';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import { buildApi } from './app.js';
import { GovernedAgentToolRuntime } from './governed-agent-tools.js';
import { loadServerConfig } from './config.js';
import { PostgresConnection } from './postgres.js';
import {
  Slice3DevelopmentEntitlements,
  ToolConfirmationCoordinator,
} from './tool-confirmation-coordinator.js';
import { PollingRunEventNotifier, PostgresRunEventNotifier } from './run-event-notifier.js';
import { WorkerRuntime } from './worker.js';

const config = loadServerConfig();
const database = new PostgresConnection(config.databaseUrl);

if (config.features.nextArchitecture && !config.features.developmentIdentity) {
  throw new Error('The current next-architecture slices require Development Identity');
}

const identity = new PostgresDevelopmentIdentity(database.pool, {
  organizationId: organizationId(config.developmentIdentity.organizationId),
  organizationName: 'Development Organization',
  principalId: principalId(config.developmentIdentity.principalId),
  principalDisplayName: config.developmentIdentity.principalDisplayName,
});
const agents = new PostgresAgentModule(database.pool, {
  agentId: agentId(config.developmentIdentity.agentId),
  echoRevisionId: agentRevisionId(config.developmentIdentity.echoAgentRevisionId),
  ...(config.features.aiSdkRuntime ? {
    aiSdkRevisionId: agentRevisionId(config.developmentIdentity.aiSdkAgentRevisionId),
  } : {}),
  activeEngineKind: config.features.aiSdkRuntime ? 'ai-sdk' : 'echo',
  name: 'Development Agent',
});
const conversations = new PostgresConversationModule(database.pool);
const execution = new PostgresExecutionModule(database.pool);

let models: ModelGateway | undefined;
let governedAgentTools: GovernedAgentToolRuntime | undefined;
let toolConfirmationCoordinator: ToolConfirmationCoordinator | undefined;
if (config.features.nextArchitecture) await identity.provision();
if (config.modelRuntime) {
  // 临时开发装配：环境变量 Profile/明文 Key 将分别由 Models Admin 与 Credential Broker Slice 替换。
  const credentials = new Map<string, string>([
    [config.modelRuntime.primary.credentialRef, config.modelRuntime.primary.apiKey],
    ...(config.modelRuntime.fallback
      ? [[config.modelRuntime.fallback.credentialRef, config.modelRuntime.fallback.apiKey] as const]
      : []),
  ]);
  models = new PostgresModelGateway(
    database.pool,
    new OpenAICompatibleModelAdapter(),
    {
      credentials,
      onProviderError: (_error, context) => {
        // Provider Error 可能携带 Prompt/响应；Server Log 只保留安全关联 ID，原始异常不落盘。
        console.error('Model provider call failed', context);
      },
    },
  );
  const profiles: ModelProfileProvisioning[] = [
    {
      id: modelProfileId(config.modelRuntime.primary.profileId),
      displayName: config.modelRuntime.primary.displayName,
      routeRole: 'primary',
      baseUrl: config.modelRuntime.primary.baseUrl,
      providerModelId: config.modelRuntime.primary.modelId,
      credentialRef: config.modelRuntime.primary.credentialRef,
      dataHandlingTier: 'development',
      costTier: 'standard',
    },
    ...(config.modelRuntime.fallback ? [{
      id: modelProfileId(config.modelRuntime.fallback.profileId),
      displayName: config.modelRuntime.fallback.displayName,
      routeRole: 'fallback' as const,
      baseUrl: config.modelRuntime.fallback.baseUrl,
      providerModelId: config.modelRuntime.fallback.modelId,
      credentialRef: config.modelRuntime.fallback.credentialRef,
      dataHandlingTier: 'development',
      costTier: 'standard',
    }] : []),
  ];
  await models.provision(identity.resolveRequest().organizationId, profiles);
}
if (config.features.nextArchitecture) {
  await agents.provision(identity.resolveRequest().organizationId);
}
if (config.features.toolRuntime) {
  const organizationId = identity.resolveRequest().organizationId;
  const approvals = new PostgresApprovalModule(database.pool);
  const catalog = new PostgresToolCatalog(database.pool);
  const providers = [
    new CurrentTimeToolProvider(),
    new TextStatisticsToolProvider(),
    new HttpsFetchToolProvider({ allowedHosts: config.toolRuntime.httpFetchAllowedHosts }),
  ];
  await catalog.provision(organizationId, workflowValidationToolCatalog());
  const toolRuntime = new PostgresToolRuntime(
    database.pool, new Slice3BaselinePolicy(), approvals, providers,
  );
  const entitlements = new Slice3DevelopmentEntitlements();
  governedAgentTools = new GovernedAgentToolRuntime(
    catalog, toolRuntime, identity, entitlements,
    WORKFLOW_VALIDATION_TOOL_GRANT_ID, execution,
  );
  toolConfirmationCoordinator = new ToolConfirmationCoordinator(
    execution, toolRuntime, entitlements,
  );
}

const notifier = config.features.nextArchitecture && config.role !== 'worker'
  ? new PostgresRunEventNotifier(config.databaseUrl)
  : new PollingRunEventNotifier();
if (notifier instanceof PostgresRunEventNotifier) await notifier.start();

const engines: AgentEngine[] = [new EchoAgentEngine()];
if (models) engines.push(new AiSdkAgentEngine(models, governedAgentTools));
const runWorker = new RunWorker(execution, conversations, engines, {
  workerId: config.worker.id,
  leaseTtlMs: config.worker.leaseTtlMs,
  maxAttempts: config.worker.maxAttempts,
});
const worker = new WorkerRuntime(database, config.features.nextArchitecture ? runWorker : undefined, {
  pollIntervalMs: config.worker.pollIntervalMs,
  concurrency: config.worker.concurrency,
});
const api = config.role === 'worker' ? undefined : buildApi({
  config,
  database,
  ...(config.features.nextArchitecture ? {
    runApi: { identity, agents, conversations, execution, notifier },
    ...(toolConfirmationCoordinator ? { toolConfirmationCoordinator } : {}),
  } : {}),
});

if (config.role === 'worker' || config.role === 'all') await worker.start();
if (api) await api.listen({ host: '0.0.0.0', port: config.apiPort });

const shutdown = async (): Promise<void> => {
  await api?.close();
  await worker.stop();
  if (notifier instanceof PostgresRunEventNotifier) await notifier.stop();
  await database.close();
};

process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
