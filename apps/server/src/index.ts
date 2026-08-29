import { agentId, agentRevisionId, PostgresAgentModule } from '@cmaster/agents';
import { PostgresConversationModule } from '@cmaster/conversations';
import { EchoAgentEngine, PostgresExecutionModule, RunWorker } from '@cmaster/execution';
import {
  organizationId,
  PostgresDevelopmentIdentity,
  principalId,
} from '@cmaster/identity';
import { buildApi } from './app.js';
import { loadServerConfig } from './config.js';
import { PostgresConnection } from './postgres.js';
import { PollingRunEventNotifier, PostgresRunEventNotifier } from './run-event-notifier.js';
import { WorkerRuntime } from './worker.js';

const config = loadServerConfig();
const database = new PostgresConnection(config.databaseUrl);

if (config.features.nextArchitecture && !config.features.developmentIdentity) {
  throw new Error('Slice 1 requires Development Identity when the next architecture is enabled');
}

const identity = new PostgresDevelopmentIdentity(database.pool, {
  organizationId: organizationId(config.developmentIdentity.organizationId),
  organizationName: 'Development Organization',
  principalId: principalId(config.developmentIdentity.principalId),
  principalDisplayName: config.developmentIdentity.principalDisplayName,
});
const agents = new PostgresAgentModule(database.pool, {
  agentId: agentId(config.developmentIdentity.agentId),
  agentRevisionId: agentRevisionId(config.developmentIdentity.agentRevisionId),
  name: 'Development Echo Agent',
});
const conversations = new PostgresConversationModule(database.pool);
const execution = new PostgresExecutionModule(database.pool);

if (config.features.nextArchitecture) {
  await identity.provision();
  await agents.provision(identity.resolveRequest().organizationId);
}

const notifier = config.features.nextArchitecture && config.role !== 'worker'
  ? new PostgresRunEventNotifier(config.databaseUrl)
  : new PollingRunEventNotifier();
if (notifier instanceof PostgresRunEventNotifier) await notifier.start();

const runWorker = new RunWorker(execution, conversations, new EchoAgentEngine(), {
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
