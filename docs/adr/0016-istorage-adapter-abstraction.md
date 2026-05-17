# ADR 0016: IStorageAdapter 抽象 — Web HTTP 实现 + Phase 13 Electron 预留

**Status**: Accepted  
**Date**: 2026-05-17  
**Phase**: P10 — Web 版 MVP  
**Deciders**: yiyisf  

---

## Context

masterBot v3 的长期路线图包含两个发行渠道：
- **Web 版**（Phase 10-12）：通过浏览器访问，所有数据通过 HTTP 调用后端 Fastify API
- **Electron 版**（Phase 13-16）：本地桌面应用，前端代码与 SQLite 数据库在同一进程，不需要 HTTP 跳转

如果 Web 版前端代码直接调用 `fetch('/api/...')`，Electron 版需要全面替换这些调用，代价巨大。需要一个抽象层隔离数据访问实现。

**约束**：
- 前端（Next.js `output: 'export'`）是纯静态导出，没有 Server-Side Rendering
- 浏览器环境不能直接访问 SQLite（node:sqlite 是 Node.js 模块）

---

## Decision

**引入 `IStorageAdapter` 接口**，将 Session / Message / Memory / Audit 四类数据访问统一抽象：

```typescript
// src/storage/types.ts
export interface IStorageAdapter {
  // Sessions
  getSession(id: string): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;
  listSessions(userId: string, limit?: number): Promise<Session[]>;
  deleteSession(id: string): Promise<void>;
  // Messages
  getMessages(sessionId: string, limit?: number): Promise<Message[]>;
  // Memory
  searchMemory(query: string, k?: number, tenantId?: string): Promise<MemoryItem[]>;
  upsertMemory(item: Omit<MemoryItem, 'id' | 'createdAt'>, tenantId?: string): Promise<void>;
  // Audit
  writeAudit(event: AuditEvent): Promise<void>;
  queryAudit(filter: AuditFilter): Promise<AuditEvent[]>;
}
```

**两个实现**：

| 实现 | 文件 | 使用场景 |
|------|------|---------|
| `WebStorageAdapter` | `src/storage/web-adapter.ts` | Web 版（Phase 10-12）：通过 HTTP 调用 Fastify API |
| `ElectronStorageAdapter`（预留）| Phase 13 实现 | Electron 版：直接 `require('node:sqlite')` 本地读写 |

**切换方式**：运行时根据环境变量或构建目标注入不同实现：
```typescript
// Phase 10: Web
const storage = new WebStorageAdapter({ baseUrl: '' });

// Phase 13: Electron（伪代码）
const storage = new ElectronStorageAdapter({ dbPath: 'data/cmaster.db' });
```

---

## Consequences

**正面影响**：
- Phase 13 Electron 适配只需实现 `IStorageAdapter`，不修改任何 UI 组件
- 接口定义强制显式声明所有数据访问操作，防止"悄悄 fetch"出现在组件中
- `WebStorageAdapter` 可作为 Electron 版的 fallback（远程桌面场景）

**负面影响**：
- Phase 10 新增了一层 HTTP 调用（`WebStorageAdapter` → Fastify → SQLite），比 Electron 版多一个网络往返
- 接口仅覆盖当前已知的四类数据；未来新增数据类型需同步扩展接口（版本管理风险）
- Phase 13 的 `ElectronStorageAdapter` 实现是承诺，若 Electron 路线取消则接口成为空抽象

---

## Alternatives Considered

1. **tRPC / React Query + 直接 HTTP 调用**：可以生成类型安全的 API 调用，但 Next.js `output: 'export'` 不支持 tRPC server，且引入新框架增加学习曲线。
2. **GraphQL 接口**：类型安全且灵活，但项目规模不需要 GraphQL 的完整方案，且引入 Apollo/Relay 增加 bundle 体积。
3. **不做抽象，Phase 13 再重构**：降低 Phase 10 复杂度，但技术债明确：Web 版有多少调用点，Electron 版就要替换多少，风险高。拒绝，因为接口定义本身成本低（< 50 行）。

---

## References

- `src/storage/types.ts` — IStorageAdapter 接口定义
- `src/storage/web-adapter.ts` — WebStorageAdapter 实现（HTTP）
- ADR-0002（Local-First 分发模式）— Phase 13 Electron 路线的架构承诺
- `docs/migration/PHASES.md` — Phase 13 Electron 准备阶段
