import { readFileSync, existsSync } from 'fs';
import type { SkillContext } from '../../../src/types.js';
import { expandPath } from '../../../src/skills/utils.js';

interface DbConnectorConfig {
    name: string;
    type: 'database';
    driver: 'mysql' | 'postgresql' | 'sqlite' | 'clickhouse';
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    filepath?: string; // for sqlite
    readonly?: boolean;
    sensitiveFields?: string[];
}

// Default sensitive field patterns to auto-mask
const DEFAULT_SENSITIVE_PATTERNS = [
    /phone|mobile|tel/i,
    /id_card|identity|national_id/i,
    /salary|wage|income|pay/i,
    /password|passwd|secret|token/i,
    /bank_account|card_no/i,
    /email/i,
];

// SQL safety: only SELECT allowed
function validateSql(sql: string): { allowed: boolean; reason?: string } {
    const normalized = sql.trim().toUpperCase().replace(/\s+/g, ' ');
    const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'REPLACE', 'EXEC', 'EXECUTE'];
    for (const kw of forbidden) {
        if (normalized.startsWith(kw) || normalized.includes(` ${kw} `) || normalized.includes(`;${kw}`)) {
            return { allowed: false, reason: `Forbidden SQL keyword: ${kw}` };
        }
    }
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH') && !normalized.startsWith('SHOW') && !normalized.startsWith('DESCRIBE') && !normalized.startsWith('EXPLAIN')) {
        return { allowed: false, reason: 'Only SELECT, SHOW, DESCRIBE, EXPLAIN queries are allowed' };
    }
    return { allowed: true };
}

function maskSensitiveData(rows: Record<string, unknown>[], sensitiveFields: string[]): Record<string, unknown>[] {
    return rows.map(row => {
        const masked: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
            const isSensitive = sensitiveFields.some(f => key.toLowerCase().includes(f.toLowerCase())) ||
                DEFAULT_SENSITIVE_PATTERNS.some(p => p.test(key));
            masked[key] = isSensitive && value !== null && value !== undefined ? '***' : value;
        }
        return masked;
    });
}

function loadConnectorConfig(datasource: string): DbConnectorConfig {
    const connectorsDir = join(process.cwd(), 'connectors');
    const candidates = [`${datasource}.yaml`, `${datasource}.json`];
    for (const candidate of candidates) {
        const filePath = join(connectorsDir, candidate);
        if (existsSync(filePath)) {
            const content = readFileSync(filePath, 'utf-8');
            if (candidate.endsWith('.json')) {
                return JSON.parse(content);
            }
            // Simple YAML parse for flat config (no nested structures needed)
            const config: Record<string, unknown> = {};
            for (const line of content.split('\n')) {
                const match = line.match(/^(\w+):\s*(.+)$/);
                if (match) {
                    const val = match[2].trim().replace(/^['"]|['"]$/g, '');
                    // Interpolate environment variables
                    config[match[1]] = val.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (_: string, varName: string, def: string) => {
                        return process.env[varName] ?? def ?? '';
                    });
                }
            }
            return config as unknown as DbConnectorConfig;
        }
    }
    throw new Error(`Connector config not found: ${datasource}. Create connectors/${datasource}.yaml`);
}

async function getConnection(config: DbConnectorConfig): Promise<any> {
    switch (config.driver) {
        case 'sqlite': {
            const { DatabaseSync } = await import('node:sqlite');
            const rawPath = config.filepath || config.database || ':memory:';
            const dbPath = rawPath === ':memory:' ? rawPath : expandPath(rawPath);
            const db = new DatabaseSync(dbPath);
            return { type: 'sqlite', db };
        }
        case 'mysql': {
            try {
                const mysql2 = await import('mysql2/promise');
                const conn = await mysql2.createConnection({
                    host: config.host || 'localhost',
                    port: config.port || 3306,
                    database: config.database,
                    user: config.username,
                    password: config.password,
                });
                return { type: 'mysql', conn };
            } catch {
                throw new Error('mysql2 not installed. Run: npm install mysql2');
            }
        }
        case 'postgresql': {
            try {
                const { Client } = await import('pg');
                const client = new Client({
                    host: config.host || 'localhost',
                    port: config.port || 5432,
                    database: config.database,
                    user: config.username,
                    password: config.password,
                });
                await client.connect();
                return { type: 'pg', client };
            } catch {
                throw new Error('pg not installed. Run: npm install pg');
            }
        }
        default:
            throw new Error(`Unsupported database driver: ${config.driver}`);
    }
}

async function runQuery(conn: any, sql: string, limit: number): Promise<Record<string, unknown>[]> {
    const limitedSql = sql.trim().replace(/;+$/, '') + ` LIMIT ${limit}`;

    if (conn.type === 'sqlite') {
        const rows = conn.db.prepare(limitedSql).all() as Record<string, unknown>[];
        return rows;
    } else if (conn.type === 'mysql') {
        const [rows] = await conn.conn.execute(limitedSql);
        await conn.conn.end();
        return rows as Record<string, unknown>[];
    } else if (conn.type === 'pg') {
        const result = await conn.client.query(limitedSql);
        await conn.client.end();
        return result.rows;
    }
    return [];
}

async function getSchemaFromDb(conn: any, table: string, driver: string): Promise<any[]> {
    let schemaSql = '';
    if (driver === 'sqlite') {
        schemaSql = `PRAGMA table_info("${table}")`;
    } else if (driver === 'mysql') {
        schemaSql = `DESCRIBE \`${table}\``;
    } else if (driver === 'postgresql') {
        schemaSql = `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`;
    }

    if (conn.type === 'sqlite') {
        return conn.db.prepare(schemaSql).all() as any[];
    } else if (conn.type === 'mysql') {
        const [rows] = await conn.conn.execute(schemaSql);
        return rows as any[];
    } else if (conn.type === 'pg') {
        const result = await conn.client.query(schemaSql);
        return result.rows;
    }
    return [];
}

/**
 * List all tables in datasource
 */
export async function list_tables(
    ctx: SkillContext,
    params: { datasource: string }
): Promise<{ tables: string[]; datasource: string; driver: string }> {
    const config = loadConnectorConfig(params.datasource);
    const conn = await getConnection(config);

    let tables: string[] = [];

    if (conn.type === 'sqlite') {
        const rows = conn.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[];
        tables = rows.map((r: any) => r.name);
    } else if (conn.type === 'mysql') {
        const [rows] = await conn.conn.execute('SHOW TABLES');
        tables = (rows as any[]).map((r: any) => Object.values(r)[0] as string);
        await conn.conn.end();
    } else if (conn.type === 'pg') {
        const result = await conn.client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
        tables = result.rows.map((r: any) => r.tablename);
        await conn.client.end();
    }

    return { tables, datasource: params.datasource, driver: config.driver };
}

/**
 * Get schema for one or more tables
 */
export async function get_schema(
    ctx: SkillContext,
    params: { datasource: string; table?: string; tables?: string[] }
): Promise<{ schemas: Record<string, any[]>; datasource: string }> {
    const config = loadConnectorConfig(params.datasource);
    const conn = await getConnection(config);

    const tableList = params.tables || (params.table ? [params.table] : []);
    if (tableList.length === 0) {
        throw new Error('Provide either "table" or "tables" parameter');
    }

    const schemas: Record<string, any[]> = {};
    for (const table of tableList) {
        schemas[table] = await getSchemaFromDb(conn, table, config.driver);
    }

    // Close connection
    if (conn.type === 'mysql') await conn.conn.end().catch(() => {});
    if (conn.type === 'pg') await conn.client.end().catch(() => {});

    return { schemas, datasource: params.datasource };
}

/**
 * Execute a read-only SQL query with safety sandbox
 */
export async function execute_query(
    ctx: SkillContext,
    params: { datasource: string; sql: string; limit?: number; format?: 'json' | 'table' | 'csv' }
): Promise<{ rows: Record<string, unknown>[]; rowCount: number; sql: string; format: string; warning?: string }> {
    const { datasource, sql, limit = 1000, format = 'json' } = params;

    // SQL safety check
    const safety = validateSql(sql);
    if (!safety.allowed) {
        throw new Error(`SQL blocked: ${safety.reason}`);
    }

    const maxLimit = Math.min(limit, 10_000);
    const config = loadConnectorConfig(datasource);

    ctx.logger.info(`[database-connector] Executing query on ${datasource}: ${sql.substring(0, 100)}...`);

    const conn = await getConnection(config);
    let rows = await runQuery(conn, sql, maxLimit);

    // Mask sensitive fields
    const sensitiveFields = config.sensitiveFields || [];
    rows = maskSensitiveData(rows, sensitiveFields);

    const warning = rows.length >= maxLimit ? `Result truncated to ${maxLimit} rows` : undefined;

    if (format === 'csv' && rows.length > 0) {
        const headers = Object.keys(rows[0]);
        const csvLines = [
            headers.join(','),
            ...rows.map(r => headers.map(h => {
                const v = String(r[h] ?? '');
                return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
            }).join(','))
        ];
        return { rows: [], rowCount: rows.length, sql, format: 'csv', warning };
    }

    if (format === 'table' && rows.length > 0) {
        // Return as rows still, the frontend/agent can render it
        return { rows, rowCount: rows.length, sql, format: 'table', warning };
    }

    return { rows, rowCount: rows.length, sql, format, warning };
}

export default { list_tables, get_schema, execute_query };
