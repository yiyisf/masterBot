import { buildApi } from './app.js';
import { loadServerConfig } from './config.js';
import { PostgresConnection } from './postgres.js';
import { WorkerRuntime } from './worker.js';

const config = loadServerConfig();
const database = new PostgresConnection(config.databaseUrl);
const worker = new WorkerRuntime(database);
const api = config.role === 'worker' ? undefined : buildApi({ config, database });

if (config.role === 'worker' || config.role === 'all') {
  await worker.start();
}

if (api) {
  await api.listen({ host: '0.0.0.0', port: config.apiPort });
}

const shutdown = async (): Promise<void> => {
  await api?.close();
  await worker.stop();
  await database.close();
};

process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});
