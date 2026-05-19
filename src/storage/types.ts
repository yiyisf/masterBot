/**
 * IStorageAdapter — 存储抽象层
 *
 * Web 阶段数据走 HTTP API（WebStorageAdapter）；
 * Phase 13 Electron 阶段引入 ElectronStorageAdapter（本地 SQLite）。
 * 上层业务代码仅依赖此接口，无需感知底层实现。
 */

export interface Session {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  content: string;
  tags?: string[];
  similarity?: number;
  createdAt: string;
}

export interface AuditEvent {
  id?: string;
  action: string;
  sessionId?: string;
  userId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  status: 'success' | 'failure' | 'pending';
  createdAt?: string;
}

export interface AuditFilter {
  sessionId?: string;
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface IStorageAdapter {
  // ── Sessions ──────────────────────────────────────────────────────────────
  getSession(id: string): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;
  listSessions(userId: string, limit?: number): Promise<Session[]>;
  deleteSession(id: string): Promise<void>;

  // ── Messages ──────────────────────────────────────────────────────────────
  getMessages(sessionId: string, limit?: number): Promise<Message[]>;

  // ── Vector Memory ─────────────────────────────────────────────────────────
  searchMemory(query: string, k?: number, tenantId?: string): Promise<MemoryItem[]>;
  upsertMemory(item: Omit<MemoryItem, 'id' | 'createdAt'>, tenantId?: string): Promise<void>;

  // ── Audit ─────────────────────────────────────────────────────────────────
  writeAudit(event: AuditEvent): Promise<void>;
  queryAudit(filter: AuditFilter): Promise<AuditEvent[]>;
}
