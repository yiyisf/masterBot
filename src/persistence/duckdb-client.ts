/**
 * Phase 6.5: DuckDB + VSS 客户端
 *
 * 提供进程内 DuckDB 单例，加载 VSS 扩展（HNSW 向量索引）。
 * 用于 Episodic Memory 的向量相似度搜索。
 *
 * 如果 DuckDB 初始化或 VSS 加载失败，所有方法静默降级——调用方通过
 * isReady() 判断是否可用，不可用时走 SQLite FTS5/LIKE 回退路径。
 */

import type { Logger } from '../types.js';

export interface VSSSearchResult {
    id: string;
    score: number;
}

export class DuckDBClient {
    private instance: any = null;
    private conn: any = null;
    private ready = false;
    private dim = 1536; // OpenAI text-embedding-3-small default

    constructor(
        private readonly dbPath: string,
        private readonly logger: Logger,
        dim?: number,
    ) {
        if (dim) this.dim = dim;
    }

    async initialize(): Promise<void> {
        try {
            const { DuckDBInstance } = await import('@duckdb/node-api');
            this.instance = await DuckDBInstance.create(this.dbPath);
            this.conn = await this.instance.connect();

            // Load VSS extension (auto-downloads on first use)
            await this.conn.run('INSTALL vss; LOAD vss;');

            // Create episodic vector table
            await this.conn.run(`
                CREATE TABLE IF NOT EXISTS episodic_vectors (
                    id VARCHAR PRIMARY KEY,
                    tenant_id VARCHAR NOT NULL,
                    vec FLOAT[${this.dim}]
                );
            `);

            // HNSW index — DROP + recreate if dimension changed
            try {
                await this.conn.run(
                    `CREATE INDEX IF NOT EXISTS hnsw_episodic ON episodic_vectors USING HNSW(vec) WITH (metric='cosine');`
                );
            } catch {
                // Index may already exist with different params; search still works via brute-force
            }

            this.ready = true;
            this.logger.info(`[duckdb] DuckDB VSS initialized (dim=${this.dim}, path=${this.dbPath})`);
        } catch (err: any) {
            this.logger.warn(`[duckdb] DuckDB VSS unavailable, vector search disabled: ${err.message}`);
            this.ready = false;
        }
    }

    isReady(): boolean { return this.ready; }

    /** 插入向量（幂等：重复 id 覆盖） */
    async upsertVector(id: string, tenantId: string, vec: number[]): Promise<void> {
        if (!this.ready) return;
        try {
            await this.conn.run(
                `INSERT OR REPLACE INTO episodic_vectors (id, tenant_id, vec) VALUES (?, ?, ?)`,
                [id, tenantId, vec],
            );
        } catch (err: any) {
            this.logger.warn(`[duckdb] upsertVector failed: ${err.message}`);
        }
    }

    /** 删除向量 */
    async deleteVector(id: string): Promise<void> {
        if (!this.ready) return;
        try {
            await this.conn.run(`DELETE FROM episodic_vectors WHERE id = ?`, [id]);
        } catch { /* ignore */ }
    }

    /**
     * 向量相似度搜索（HNSW cosine）。
     * 租户强制隔离：WHERE tenant_id = ?
     */
    async searchSimilar(queryVec: number[], tenantId: string, k: number): Promise<VSSSearchResult[]> {
        if (!this.ready) return [];
        try {
            const reader = await this.conn.runAndReadAll(
                `SELECT id, array_cosine_similarity(vec, ?::FLOAT[${this.dim}]) AS score
                 FROM episodic_vectors
                 WHERE tenant_id = ?
                 ORDER BY score DESC
                 LIMIT ?`,
                [queryVec, tenantId, k],
            );
            return reader.getRows().map((row: [string, number]) => ({
                id: row[0],
                score: row[1],
            }));
        } catch (err: any) {
            this.logger.warn(`[duckdb] searchSimilar failed: ${err.message}`);
            return [];
        }
    }

    /** 清理已过期 id 对应的向量（与 episodic_memories 同步） */
    async deleteByIds(ids: string[]): Promise<void> {
        if (!this.ready || ids.length === 0) return;
        try {
            const placeholders = ids.map(() => '?').join(', ');
            await this.conn.run(`DELETE FROM episodic_vectors WHERE id IN (${placeholders})`, ids);
        } catch { /* ignore */ }
    }

    async close(): Promise<void> {
        // @duckdb/node-api handles cleanup via GC; explicit close not required
        this.ready = false;
    }
}

/** 进程级单例 */
let _client: DuckDBClient | undefined;

export function getDuckDBClient(): DuckDBClient | undefined { return _client; }

export async function initDuckDB(dbPath: string, logger: Logger, dim?: number): Promise<DuckDBClient> {
    _client = new DuckDBClient(dbPath, logger, dim);
    await _client.initialize();
    return _client;
}
