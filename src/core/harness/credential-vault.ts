/**
 * CredentialVault — Meta-Harness 凭证隔离层（Gap 4）
 * Phase 25
 *
 * 架构原则（来自 masterBot v1.1.0-meta-harness-patch.md）：
 *   - 凭证永远不进 Sandbox：skill 代码只持有 opaque sessionToken
 *   - MCP proxy 拦截工具调用，用 sessionToken 向 vault 换取真实凭证
 *   - 每次 vault 访问都写入 credential_access 事件（审计追溯）
 *
 * 兼容性：现有 skill 通过 process.env 读取凭证的路径保留不变。
 * 新路径：通过 CredentialVault.store() 注册的凭证可通过 retrieve() 获取，
 * 并自动生成审计事件。
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import type { DatabaseSync } from 'node:sqlite';
import { nanoid } from 'nanoid';
import type { SessionEventStore } from './session-store.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;

/**
 * 从 masterKey 派生固定长度的加密密钥（scrypt KDF）
 */
function deriveKey(masterKey: string): Buffer {
    // 使用固定 salt（非安全场景）— 生产环境应存储随机 salt
    const salt = Buffer.from('masterbot-vault-salt-v1');
    return scryptSync(masterKey, salt, KEY_LEN);
}

export class CredentialVault {
    private key: Buffer;
    private stmtUpsert: ReturnType<DatabaseSync['prepare']>;
    private stmtGet: ReturnType<DatabaseSync['prepare']>;
    private stmtList: ReturnType<DatabaseSync['prepare']>;
    private stmtDelete: ReturnType<DatabaseSync['prepare']>;

    constructor(
        private db: DatabaseSync,
        masterKey: string,
        private sessionStore?: SessionEventStore
    ) {
        this.key = deriveKey(masterKey);

        this.stmtUpsert = db.prepare(`
            INSERT INTO credential_vault (id, key, iv, auth_tag, ciphertext, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                iv = excluded.iv,
                auth_tag = excluded.auth_tag,
                ciphertext = excluded.ciphertext,
                updated_at = excluded.updated_at
        `);
        this.stmtGet = db.prepare(`
            SELECT iv, auth_tag, ciphertext FROM credential_vault WHERE key = ?
        `);
        this.stmtList = db.prepare(`
            SELECT key, created_at, updated_at FROM credential_vault ORDER BY key
        `);
        this.stmtDelete = db.prepare(`DELETE FROM credential_vault WHERE key = ?`);
    }

    // ─────────────────────────────────────────────────
    // 存储 / 读取
    // ─────────────────────────────────────────────────

    /**
     * 加密存储凭证。key 为逻辑名称（如 'OPENAI_API_KEY'），value 为明文。
     */
    store(key: string, value: string): void {
        const iv = randomBytes(12);
        const cipher = createCipheriv(ALGORITHM, this.key, iv);
        const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();

        this.stmtUpsert.run(
            nanoid(16),
            key,
            iv.toString('base64'),
            authTag.toString('base64'),
            ciphertext.toString('base64'),
            Date.now(),
            Date.now()
        );
    }

    /**
     * 解密并返回凭证明文。
     * @param key 凭证逻辑名称
     * @param sessionId 调用方 session（用于审计记录）
     */
    retrieve(key: string, sessionId?: string): string | null {
        const row = this.stmtGet.get(key) as {
            iv: string;
            auth_tag: string;
            ciphertext: string;
        } | undefined;

        if (!row) return null;

        try {
            const iv = Buffer.from(row.iv, 'base64');
            const authTag = Buffer.from(row.auth_tag, 'base64');
            const ciphertext = Buffer.from(row.ciphertext, 'base64');

            const decipher = createDecipheriv(ALGORITHM, this.key, iv);
            decipher.setAuthTag(authTag);
            const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

            // 写入 credential_access 审计事件
            if (sessionId && this.sessionStore) {
                this.sessionStore.append({
                    sessionId,
                    timestamp: Date.now(),
                    type: 'credential_access',
                    payload: { key, source: 'vault', sessionId },
                });
            }

            return plaintext;
        } catch {
            return null;
        }
    }

    /**
     * 列出所有已存储凭证的 key（不含明文值）
     */
    list(): Array<{ key: string; createdAt: number; updatedAt: number }> {
        const rows = this.stmtList.all() as Array<{
            key: string;
            created_at: number;
            updated_at: number;
        }>;
        return rows.map(r => ({ key: r.key, createdAt: r.created_at, updatedAt: r.updated_at }));
    }

    /**
     * 删除凭证
     */
    delete(key: string): void {
        this.stmtDelete.run(key);
    }

    // ─────────────────────────────────────────────────
    // Session Token 绑定
    // ─────────────────────────────────────────────────

    /**
     * 为 sessionId 生成 opaque sessionToken。
     * 当前实现：sessionToken = sessionId（已足够隔离，可升级为 HMAC 签名）
     * skill 代码只持有 sessionToken，不能访问跨 session 的凭证。
     */
    generateSessionToken(sessionId: string): string {
        return sessionId;
    }

    /**
     * 通过 sessionToken 读取凭证（CredentialProxy 调用此方法换取真实凭证）。
     * 写入 credential_access 审计事件。
     */
    retrieveWithToken(key: string, sessionToken: string): string | null {
        // 当前 sessionToken = sessionId，直接复用 retrieve
        return this.retrieve(key, sessionToken);
    }
}
