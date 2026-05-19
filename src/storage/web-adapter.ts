/**
 * WebStorageAdapter — 通过 HTTP API 访问服务端数据
 *
 * Web 阶段的标准实现；Phase 13 Electron 阶段将替换为本地 SQLite 直连。
 */

import type { IStorageAdapter, Session, Message, MemoryItem, AuditEvent, AuditFilter } from './types.js';

export class WebStorageAdapter implements IStorageAdapter {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: { baseUrl?: string; apiKey?: string } = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.apiKey = options.apiKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['X-API-Key'] = this.apiKey;
    return h;
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers as Record<string, string> ?? {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async getSession(id: string): Promise<Session | null> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${id}`, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json() as Promise<Session>;
  }

  async saveSession(session: Session): Promise<void> {
    await this.fetch(`/api/sessions`, {
      method: 'POST',
      body: JSON.stringify(session),
    });
  }

  async listSessions(userId: string, limit = 50): Promise<Session[]> {
    const params = new URLSearchParams({ userId, limit: String(limit) });
    const res = await this.fetch<{ sessions: Session[] }>(`/api/sessions?${params}`);
    return res.sessions ?? [];
  }

  async deleteSession(id: string): Promise<void> {
    await this.fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  async getMessages(sessionId: string, limit = 100): Promise<Message[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    const res = await this.fetch<{ messages: Message[] }>(
      `/api/sessions/${sessionId}/messages?${params}`,
    );
    return res.messages ?? [];
  }

  // ── Vector Memory ─────────────────────────────────────────────────────────

  async searchMemory(query: string, k = 5, _tenantId?: string): Promise<MemoryItem[]> {
    const params = new URLSearchParams({ query, k: String(k) });
    const res = await this.fetch<{ results: MemoryItem[] }>(`/api/memories/search?${params}`);
    return res.results ?? [];
  }

  async upsertMemory(item: Omit<MemoryItem, 'id' | 'createdAt'>, _tenantId?: string): Promise<void> {
    await this.fetch('/api/memories', { method: 'POST', body: JSON.stringify(item) });
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  async writeAudit(event: AuditEvent): Promise<void> {
    await this.fetch('/api/audit/events', { method: 'POST', body: JSON.stringify(event) });
  }

  async queryAudit(filter: AuditFilter): Promise<AuditEvent[]> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const res = await this.fetch<{ events: AuditEvent[] }>(`/api/audit/events?${params}`);
    return res.events ?? [];
  }
}
