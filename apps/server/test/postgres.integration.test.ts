import { afterAll, describe, expect, it } from 'vitest';
import { PostgresConnection } from '../src/postgres.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
}

const database = new PostgresConnection(databaseUrl);

afterAll(async () => {
  await database.close();
});

describe('PostgresConnection', () => {
  it('checks connectivity and commits a transaction', async () => {
    expect(await database.check()).toBe(true);

    const value = await database.transaction(async (client) => {
      const result = await client.query<{ value: number }>('SELECT 42::int AS value');
      return result.rows[0]?.value;
    });

    expect(value).toBe(42);
  });
});
