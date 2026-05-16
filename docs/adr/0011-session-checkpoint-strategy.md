# ADR 0011: Session Fork/Checkpoint 存储策略 — SDK JSONL 优先 + SQLite Fallback

**Status**: Accepted  
**Date**: 2026-05-13  
**Phase**: P5 — Session 高级特性  
**Deciders**: yiyisf  

---

## Context

Phase 5 需要实现三个 session 管理能力：

- **fork()**：从当前对话创建可独立演进的分支
- **checkpoint()**：保存对话快照，支持未来恢复
- **resume()**：从指定 checkpoint 恢复对话

**技术约束**：
- ClaudeManagedAgent 使用 SDK 管理 session，SDK 内部用 JSONL 格式持久化消息（`~/.claude/projects/`）
- LegacySelfHostedAgent 使用 SQLite `messages` 表，无 SDK session 概念
- 两路径需共享同一套 `fork/checkpoint/resume` API

---

## Decision

**Checkpoint 存储：SDK JSONL 优先，SQLite 兜底**

```
checkpoint() 执行顺序：
  1. 尝试从 SDK JSONL 文件读取消息快照（SDK session 的完整记录）
  2. 若 SDK 路径不可用（Legacy 模式 / JSONL 不存在）→ fallback 到 historyRepository
  3. 快照写入 SQLite `checkpoints` 表（JSON 序列化，含 label、createdAt）
```

**Fork 实现**：
- ClaudeManagedAgent：调用 SDK `forkSession()`，写入 `sessions.parent_session_id`
- LegacySelfHostedAgent：复制消息记录到新 session，断开 SDK 关联

**Resume 实现**（Phase 5 交付范围）：
- 优先走 LegacySelfHostedAgent 路径（通过 `AgentRouter.legacyAgent.resume()`）
- ClaudeManagedAgent resume 依赖 SDK session ID，推迟至 SDK API 稳定后实现

---

## Consequences

**正面影响**：
- Fork/Checkpoint 对前端透明（统一 API，两路径行为一致）
- SQLite fallback 保证离线可用（无需 SDK session 文件）
- `sessions.parent_session_id` 自动迁移（`ALTER TABLE IF NOT EXISTS` 兼容旧数据库）

**负面影响**：
- Resume 在 ClaudeManagedAgent 路径下降级为 Legacy 执行（SDK session 上下文丢失）
- SDK JSONL 文件位置（`~/.claude/projects/`）依赖 Anthropic SDK 内部约定，SDK 升级可能 break 路径
- `checkpoints` 表以 JSON 整体存储消息列表，大对话 checkpoint 可能占用较多空间

---

## Alternatives Considered

1. **只用 SQLite 存储，忽略 SDK JSONL**：简单统一，但 ClaudeManagedAgent 路径的 SDK session 元数据（如 compaction 状态）丢失，resume 质量下降。拒绝。
2. **只用 SDK JSONL，不写 SQLite**：Legacy 路径无法使用 checkpoint；且 JSONL 路径在不同操作系统和 SDK 版本间不稳定。拒绝。
3. **实时同步（每条消息写 checkpoint）**：开销过高，且 UI 上"手动保存检查点"语义更清晰。拒绝。

---

## References

- `src/core/agent/claude-managed.ts`（fork / checkpoint 实现）
- `src/core/repository.ts`（recordFork / historyRepository）
- `src/gateway/server.ts`（checkpoint CRUD + restore 端点）
- `web/src/components/chat/fork-button.tsx`
