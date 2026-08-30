import path from 'node:path';
import { runner } from 'node-pg-migrate';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to run migrations');

const modules = ['identity', 'agents', 'conversations', 'execution', 'models'];
for (const moduleName of modules) {
  await runner({
    databaseUrl,
    direction: 'up',
    dir: path.resolve(`packages/${moduleName}/migrations`),
    migrationsTable: `pgmigrations_${moduleName}`,
    count: Number.POSITIVE_INFINITY,
    checkOrder: true,
    advisoryLockMode: 'wait',
    log: (message) => console.log(`[${moduleName}] ${message}`),
  });
}
